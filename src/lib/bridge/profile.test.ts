import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import {
  BRIDGE_BATCH_MAX,
  completeProfileTransfer,
  getProfileSelection,
  PROFILE_DISCOVERY_MAX,
  receiveProfileCharacterBatch,
  receiveProfileDiscovery,
  recordProfileItemFailure,
  selectProfileCharacters,
  type ProfileCoordinator,
} from "./profile";
import { storedBridgeTarget } from "./target";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const ARCHIVE_ORIGIN = "http://localhost:3000";
const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const PROFILE_ID = "9502024d-a6b5-4348-b556-31a37fbd6f2a";
const PROFILE_URL = `https://janitorai.com/profiles/${PROFILE_ID}`;
const TOKEN = "b".repeat(43);
const ALLOWED = new Set([ARCHIVE_ORIGIN]);

describe("profile bridge coordinator", () => {
  it("persists only bounded lightweight discovery metadata and deduplicates UUIDs", async () => {
    const harness = coordinatorHarness();
    const id = uuid(1);
    const result = await receiveProfileDiscovery(TOKEN, {
      profileId: PROFILE_ID,
      reportedTotal: 120,
      truncated: true,
      items: [item(id), item(id), { externalId: "not-a-uuid", name: "Rejected" }],
    }, ARCHIVE_ORIGIN, options(harness.client));

    expect(result).toEqual({ jobId: "job-1", discovered: 1, truncated: true });
    expect(harness.preview).toMatchObject({ kind: "PROFILE_IMPORT", profileId: PROFILE_ID, truncated: true });
    expect(harness.preview.items).toHaveLength(1);
    expect(JSON.stringify(harness.preview)).not.toContain("description");
    expect(JSON.stringify(harness.preview)).not.toContain("authorization");
  });

  it("rejects cross-user selection and any undiscovered character UUID", async () => {
    const harness = coordinatorHarness(discoveredCoordinator([uuid(1), uuid(2)]));
    await expect(selectProfileCharacters("other-session", "job-1", { selectedIds: [uuid(1)] }, {
      client: { bridgeJob: { findFirst: vi.fn(async () => null) } } as unknown as PrismaClient,
    })).rejects.toMatchObject({ code: "BRIDGE_JOB_NOT_FOUND", status: 404 });
    await expect(selectProfileCharacters("owner-session", "job-1", { selectedIds: [uuid(99)] }, { client: harness.client, now: () => NOW }))
      .rejects.toMatchObject({ code: "UNDISCOVERED_CHARACTER", status: 422 });

    const selected = await selectProfileCharacters("owner-session", "job-1", { selectedIds: [uuid(2)] }, { client: harness.client, now: () => NOW });
    expect(selected.selectedIds).toEqual([uuid(2)]);
    expect(selected.items.find((entry) => entry.externalId === uuid(1))?.status).toBe("DISCOVERED");
    expect(selected.items.find((entry) => entry.externalId === uuid(2))?.status).toBe("SELECTED");
  });

  it("creates one independent immutable preview job per accepted character and isolates malformed neighbors", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const coordinator = discoveredCoordinator(ids); coordinator.selectedIds = [...ids];
    coordinator.items.forEach((entry) => { entry.status = "SELECTED"; });
    const harness = coordinatorHarness(coordinator);
    const result = await receiveProfileCharacterBatch(TOKEN, {
      envelopes: [envelope(ids[0]), envelope(ids[1]), envelope(uuid(99))],
    }, ARCHIVE_ORIGIN, options(harness.client));

    expect(result.results).toEqual([
      expect.objectContaining({ externalId: ids[0], status: "PREVIEW_READY" }),
      expect.objectContaining({ externalId: ids[1], status: "PREVIEW_READY" }),
      { externalId: uuid(99), status: "FAILED", errorCode: "UNDISCOVERED_CHARACTER" },
    ]);
    expect(harness.previewCreate).toHaveBeenCalledTimes(2);
    const snapshots = harness.previewCreate.mock.calls.map(([argument]) => (argument as { data: { snapshot: unknown } }).data.snapshot);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).not.toBe(snapshots[1]);
    expect(JSON.stringify(harness.preview)).not.toContain('"payload"');
  });

  it("claims the validated selection for retrieval before any detail result arrives", async () => {
    const coordinator = discoveredCoordinator([uuid(1), uuid(2)]);
    coordinator.selectedIds = [uuid(2)]; coordinator.items[1]!.status = "SELECTED";
    const harness = coordinatorHarness(coordinator);
    await expect(getProfileSelection(TOKEN, ARCHIVE_ORIGIN, options(harness.client))).resolves.toEqual({ jobId: "job-1", selectedIds: [uuid(2)] });
    expect(harness.preview.phase).toBe("RETRIEVING");
    expect(harness.preview.items[1].status).toBe("QUEUED");
  });

  it("enforces the transfer maximum and records per-item terminal failures without poisoning ready previews", async () => {
    const ids = Array.from({ length: BRIDGE_BATCH_MAX + 1 }, (_, index) => uuid(index + 1));
    const coordinator = discoveredCoordinator(ids); coordinator.selectedIds = [...ids];
    const harness = coordinatorHarness(coordinator);
    await expect(receiveProfileCharacterBatch(TOKEN, { envelopes: ids.map(envelope) }, ARCHIVE_ORIGIN, options(harness.client)))
      .rejects.toMatchObject({ code: "INVALID_PROFILE_BATCH", status: 422 });

    const failure = await recordProfileItemFailure(TOKEN, { externalId: ids[0], status: "AUTH_REQUIRED", errorCode: "AUTH_REQUIRED" }, ARCHIVE_ORIGIN, options(harness.client));
    expect(failure.status).toBe("AUTH_REQUIRED");
    expect(harness.preview.items[0].status).toBe("AUTH_REQUIRED");
  });

  it("accepts 25 successful details only through batches of ten or fewer", async () => {
    const ids = Array.from({ length: 25 }, (_, index) => uuid(index + 1));
    const coordinator = discoveredCoordinator(ids); coordinator.selectedIds = [...ids];
    coordinator.items.forEach((entry) => { entry.status = "QUEUED"; }); coordinator.phase = "RETRIEVING";
    const harness = coordinatorHarness(coordinator);
    const batches = [ids.slice(0, 10), ids.slice(10, 20), ids.slice(20)];
    for (const batch of batches) {
      const result = await receiveProfileCharacterBatch(TOKEN, { envelopes: batch.map(envelope) }, ARCHIVE_ORIGIN, options(harness.client));
      expect(result.results).toHaveLength(batch.length);
    }
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 5]);
    expect(harness.previewCreate).toHaveBeenCalledTimes(25);
    expect(harness.preview.phase).toBe("REVIEW");
  });

  it("finalizes review independently and consumes only the expiring profile capability", async () => {
    const coordinator = discoveredCoordinator([uuid(1), uuid(2)]);
    coordinator.selectedIds = [uuid(1), uuid(2)]; coordinator.phase = "RETRIEVING";
    coordinator.items[0]!.status = "PREVIEW_READY"; coordinator.items[0]!.previewJobId = "preview-job-one";
    coordinator.items[1]!.status = "RETRIEVING";
    const harness = coordinatorHarness(coordinator);
    const result = await completeProfileTransfer(TOKEN, { status: "COMPLETE" }, ARCHIVE_ORIGIN, options(harness.client));

    expect(result.phase).toBe("REVIEW");
    expect(harness.preview.items[0].status).toBe("PREVIEW_READY");
    expect(harness.preview.items[1].status).toBe("FAILED");
    expect(harness.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { consumedAt: NOW } }));
  });

  it("centralizes the documented bounds", () => {
    expect(PROFILE_DISCOVERY_MAX).toBe(100);
    expect(BRIDGE_BATCH_MAX).toBe(10);
  });
});

function coordinatorHarness(initialPreview: ProfileCoordinator | null = null) {
  let preview = initialPreview;
  const session = {
    id: "bridge-session-1", expiresAt: new Date(NOW.getTime() + 60_000), consumedAt: null, cancelledAt: null,
    pairing: { archiveOrigin: ARCHIVE_ORIGIN, cancelledAt: null, userSessionId: "owner-session" },
    job: {
      id: "job-1",
      sourceUrl: PROFILE_URL,
      payload: storedBridgeTarget({
        targetKind: "PROFILE",
        platform: "JANITOR_AI",
        profileId: PROFILE_ID,
        canonicalProfileUrl: PROFILE_URL,
      }),
      get preview() { return preview; },
    },
  };
  const previewCreate = vi.fn(async (argument: unknown) => { void argument; return { id: `preview-job-${previewCreate.mock.calls.length}` }; });
  const sessionUpdateMany = vi.fn(async () => ({ count: 1 }));
  const bridgeJob = {
    findFirst: vi.fn(async ({ where }: { where: { pairing?: { userSessionId?: string } } }) => where.pairing?.userSessionId === "owner-session" ? { id: "job-1", status: "PAIRED", expiresAt: new Date(NOW.getTime() + 60_000), preview } : null),
    update: vi.fn(async ({ data }: { data: { preview?: unknown } }) => { if (data.preview) preview = data.preview as unknown as ProfileCoordinator; return { id: "job-1" }; }),
  };
  const tx = { bridgeJob, bridgeSession: { updateMany: sessionUpdateMany } };
  const client = {
    bridgeSession: { findUnique: vi.fn(async () => session), updateMany: sessionUpdateMany },
    bridgeJob,
    importPreviewJob: { create: previewCreate },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  } as unknown as PrismaClient;
  return { client, previewCreate, sessionUpdateMany, get preview(): ProfileCoordinator { if (!preview) throw new Error("Profile coordinator is unavailable."); return preview; } };
}
function options(client: PrismaClient) { return { client, now: () => NOW, allowedArchiveOrigins: ALLOWED, capabilityOrigin: EXTENSION_ORIGIN, analyze: async () => ({ classification: "NO_MATCH" as const, candidates: [] }), moderate: async () => ({ blocked: false, matches: [] }) }; }
function discoveredCoordinator(ids: string[]): ProfileCoordinator {
  return { kind: "PROFILE_IMPORT", version: 1, phase: "DISCOVERED", profileId: PROFILE_ID, canonicalProfileUrl: PROFILE_URL, truncated: false, reportedTotal: ids.length, selectedIds: [], items: ids.map((id) => ({ ...item(id), status: "DISCOVERED", previewJobId: null, previewExpiresAt: null, duplicateClassification: null, moderationBlocked: null, errorCode: null, savedCharacterId: null })) };
}
function uuid(index: number) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`; }
function item(externalId: string) { return { externalId, name: `Character ${externalId.slice(-2)}`, avatarUrl: null, creatorName: "owner", createdAt: null, updatedAt: null }; }
function envelope(externalId: string) { return { bridgeVersion: 1, observerContractVersion: 1, messageId: `00000000-0000-4000-8000-${externalId.slice(-12)}`, platform: "JANITOR_AI", type: "CHARACTER", capturedAt: NOW.toISOString(), source: { url: `https://janitorai.com/characters/${externalId}` }, payload: { id: externalId, name: `Character ${externalId.slice(-2)}` } }; }
