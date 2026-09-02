import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client";
import {
  BRIDGE_PAIRING_TTL_MS,
  BRIDGE_PROFILE_SESSION_TTL_MS,
  BRIDGE_SESSION_TTL_MS,
  createBridgePairing,
  exchangeBridgePairing,
  getBridgeJob,
  receiveBridgeCharacter,
} from "./service";
import { storedBridgeTarget } from "./target";

const NOW = new Date("2026-08-24T09:30:00.000Z");
const ARCHIVE_ORIGIN = "http://localhost:3000";
const EXTENSION_ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const ALLOWED = new Set([ARCHIVE_ORIGIN]);
const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const SOURCE_URL = `https://janitorai.com/characters/${CHARACTER_ID}`;
const PAGE_URL = `${SOURCE_URL}_character-theron`;
const TARGET = {
  targetKind: "CHARACTER" as const,
  platform: "JANITOR_AI",
  externalId: CHARACTER_ID,
  canonicalSourceUrl: SOURCE_URL,
  pageOrigin: "https://janitorai.com",
};
const CHARACTER_TARGET = {
  targetKind: "CHARACTER" as const,
  platform: "JANITOR_AI" as const,
  externalId: CHARACTER_ID,
  canonicalSourceUrl: SOURCE_URL,
};
const CHARACTER_REQUEST = {
  targetKind: "CHARACTER" as const,
  platform: "JANITOR_AI" as const,
  characterUrl: PAGE_URL,
};
const PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_URL = `https://janitorai.com/profiles/${PROFILE_ID}`;
const PROFILE_TARGET = {
  targetKind: "PROFILE" as const,
  platform: "JANITOR_AI" as const,
  profileId: PROFILE_ID,
  canonicalProfileUrl: PROFILE_URL,
  pageOrigin: "https://janitorai.com" as const,
};
const PROFILE_STORED_TARGET = {
  targetKind: "PROFILE" as const,
  platform: "JANITOR_AI" as const,
  profileId: PROFILE_ID,
  canonicalProfileUrl: PROFILE_URL,
};
const PROFILE_REQUEST = {
  targetKind: "PROFILE" as const,
  platform: "JANITOR_AI" as const,
  profileUrl: `${PROFILE_URL}_profile-of-example-creator`,
};

function fixedRandom(value: number) { return (size: number) => Buffer.alloc(size, value); }
function envelope(payload: Record<string, unknown> = { id: CHARACTER_ID, name: "Theron" }) {
  return {
    bridgeVersion: 1,
    observerContractVersion: 1,
    messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    platform: "JANITOR_AI",
    type: "CHARACTER",
    capturedAt: NOW.toISOString(),
    source: { url: SOURCE_URL },
    payload,
  };
}

function exchangeHarness(sourceUrl = SOURCE_URL) {
  const target = sourceUrl === PROFILE_URL ? PROFILE_STORED_TARGET : CHARACTER_TARGET;
  const pairing = {
    id: "pair-1", archiveOrigin: ARCHIVE_ORIGIN, platform: "JANITOR_AI", operation: "CHARACTER_IMPORT",
    expiresAt: new Date(NOW.getTime() + 60_000), usedAt: null as Date | null,
    cancelledAt: null, exchangeAttempts: 0, job: { id: "job-1", sourceUrl, payload: storedBridgeTarget(target) },
  };
  const sessionCreate = vi.fn(async (args: unknown) => { void args; return { id: "bridge-session-1" }; });
  const tx = {
    bridgePairing: {
      findUnique: vi.fn(async () => pairing),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if ("exchangeAttempts" in data) pairing.exchangeAttempts += 1;
        if ("usedAt" in data) pairing.usedAt = data.usedAt as Date;
        return pairing;
      }),
    },
    bridgeSession: { create: sessionCreate },
    bridgeJob: { update: vi.fn(async () => ({ id: "job-1" })) },
  };
  return {
    pairing,
    sessionCreate,
    client: { $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaClient,
  };
}

function receiveHarness(claimCount = 1) {
  const session = {
    id: "bridge-session-1", platform: "JANITOR_AI", payloadType: "CHARACTER",
    expiresAt: new Date(NOW.getTime() + 60_000), consumedAt: null as Date | null, cancelledAt: null as Date | null,
    pairing: {
      archiveOrigin: ARCHIVE_ORIGIN, cancelledAt: null, userSessionId: "owner-session-1",
      operation: "CHARACTER_IMPORT",
    },
    job: { id: "job-1", sourceUrl: SOURCE_URL, payload: storedBridgeTarget(CHARACTER_TARGET) },
  };
  const previewCreate = vi.fn(async (args: unknown) => { void args; return { id: "preview-job-123456" }; });
  const jobUpdate = vi.fn(async (args: unknown) => { void args; return { id: "job-1" }; });
  const tx = {
    bridgeSession: { updateMany: vi.fn(async () => ({ count: claimCount })) },
    importPreviewJob: { create: previewCreate },
    bridgeJob: { update: jobUpdate },
  };
  const findUnique = vi.fn(async () => session);
  return {
    session, findUnique, previewCreate, jobUpdate,
    client: {
      bridgeSession: { findUnique },
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    } as unknown as PrismaClient,
  };
}

describe("target-bound browser bridge", () => {
  it("creates an owner-bound pairing with an authoritative canonical target", async () => {
    const create = vi.fn(async () => ({ job: { id: "job-1" } }));
    const client = { bridgePairing: { create } } as unknown as PrismaClient;
    const result = await createBridgePairing("owner-session-1", ARCHIVE_ORIGIN, CHARACTER_REQUEST, {
      client, now: () => NOW, allowedArchiveOrigins: ALLOWED, randomBytes: fixedRandom(1),
    });

    expect(result).toEqual({
      pairingCode: "0101-0101-0101-0101", jobId: "job-1",
      expiresAt: new Date(NOW.getTime() + BRIDGE_PAIRING_TTL_MS).toISOString(),
      target: CHARACTER_TARGET,
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userSessionId: "owner-session-1",
      job: { create: {
        expiresAt: new Date(NOW.getTime() + BRIDGE_PAIRING_TTL_MS),
        sourceUrl: SOURCE_URL,
        payload: storedBridgeTarget(CHARACTER_TARGET),
      } },
    }) }));
  });

  it("creates a profile pairing with an explicit canonical PROFILE target", async () => {
    const create = vi.fn(async () => ({ job: { id: "profile-job" } }));
    const client = { bridgePairing: { create } } as unknown as PrismaClient;
    const result = await createBridgePairing(
      "owner-session-1",
      ARCHIVE_ORIGIN,
      PROFILE_REQUEST,
      { client, now: () => NOW, allowedArchiveOrigins: ALLOWED, randomBytes: fixedRandom(1) },
    );

    expect(result).toMatchObject({ target: {
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileId: PROFILE_ID,
      canonicalProfileUrl: PROFILE_URL,
    } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      job: { create: {
        expiresAt: new Date(NOW.getTime() + BRIDGE_PAIRING_TTL_MS),
        sourceUrl: PROFILE_URL,
        payload: storedBridgeTarget(PROFILE_STORED_TARGET),
      } },
    }) }));
  });

  it("rejects wrong-type pairing requests before creating bridge ephemera", async () => {
    const create = vi.fn(async () => ({ job: { id: "should-not-exist" } }));
    const client = { bridgePairing: { create } } as unknown as PrismaClient;
    for (const request of [
      { targetKind: "CHARACTER", platform: "JANITOR_AI", characterUrl: PROFILE_REQUEST.profileUrl },
      { targetKind: "PROFILE", platform: "JANITOR_AI", profileUrl: CHARACTER_REQUEST.characterUrl },
    ]) {
      await expect(createBridgePairing("owner-session-1", ARCHIVE_ORIGIN, request, {
        client, now: () => NOW, allowedArchiveOrigins: ALLOWED, randomBytes: fixedRandom(1),
      })).rejects.toMatchObject({ code: "INVALID_PAIRING_TARGET", status: 400 });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("binds the one-time capability to the exact extension origin and selected target", async () => {
    const harness = exchangeHarness();
    const result = await exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
      client: harness.client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      randomBytes: fixedRandom(2), capabilityOrigin: EXTENSION_ORIGIN, presentedTarget: TARGET,
    });
    expect(result).toMatchObject({
      target: TARGET,
      expiresAt: new Date(NOW.getTime() + BRIDGE_SESSION_TTL_MS).toISOString(),
    });
    const data = (harness.sessionCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(data.tokenHash).not.toBe(result.bridgeToken);

    const otherOriginHarness = exchangeHarness();
    await exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
      client: otherOriginHarness.client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      randomBytes: fixedRandom(2), capabilityOrigin: `chrome-extension://${"b".repeat(32)}`, presentedTarget: TARGET,
    });
    const otherOriginData = (otherOriginHarness.sessionCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(otherOriginData.tokenHash).not.toBe(data.tokenHash);

    for (const [presentedTarget, code] of [
      [{ ...TARGET, platform: "DATACAT" }, "INVALID_PAIRING_TARGET"],
      [{ ...TARGET, externalId: "62650d46-bcda-4eac-90a5-1162cb3d5d80", canonicalSourceUrl: "https://janitorai.com/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80" }, "WRONG_CHARACTER"],
      [{ ...TARGET, canonicalSourceUrl: `https://janitorai.com/characters/${CHARACTER_ID}_character-mutated` }, "INVALID_PAIRING_TARGET"],
    ] as const) {
      const wrong = exchangeHarness();
      await expect(exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
        client: wrong.client, now: () => NOW, allowedArchiveOrigins: ALLOWED, presentedTarget,
      })).rejects.toMatchObject({ code, status: 409 });
    }
  });

  it("preserves an explicit profile target through pairing exchange and capability creation", async () => {
    const harness = exchangeHarness(PROFILE_URL);
    const result = await exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
      client: harness.client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      randomBytes: fixedRandom(3), capabilityOrigin: EXTENSION_ORIGIN, presentedTarget: PROFILE_TARGET,
    });

    expect(result).toMatchObject({
      target: PROFILE_TARGET,
      expiresAt: new Date(NOW.getTime() + BRIDGE_PROFILE_SESSION_TTL_MS).toISOString(),
    });
    expect((harness.sessionCreate.mock.calls[0]![0] as { data: Record<string, unknown> }).data)
      .toMatchObject({ platform: "JANITOR_AI", payloadType: "CHARACTER" });
  });

  it("uses target-kind-aware mismatch errors", async () => {
    await expect(exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
      client: exchangeHarness(PROFILE_URL).client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      presentedTarget: { ...PROFILE_TARGET, profileId: "00000000-0000-4000-8000-000000000002", canonicalProfileUrl: "https://janitorai.com/profiles/00000000-0000-4000-8000-000000000002" },
    })).rejects.toMatchObject({ code: "WRONG_PROFILE", status: 409 });
    await expect(exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
      client: exchangeHarness(PROFILE_URL).client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      presentedTarget: TARGET,
    })).rejects.toMatchObject({ code: "WRONG_PROFILE", status: 409 });
    await expect(exchangeBridgePairing("0101-0101-0101-0101", ARCHIVE_ORIGIN, {
      client: exchangeHarness().client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      presentedTarget: PROFILE_TARGET,
    })).rejects.toMatchObject({ code: "WRONG_CHARACTER", status: 409 });
  });

  it("turns one accepted capture into the immutable ImportPreviewJob and clears BridgeJob payload", async () => {
    const harness = receiveHarness();
    const result = await receiveBridgeCharacter(fixedRandom(2)(32).toString("base64url"), envelope(), ARCHIVE_ORIGIN, {
      client: harness.client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      capabilityOrigin: EXTENSION_ORIGIN,
      analyze: async () => ({ classification: "NO_MATCH", candidates: [] }),
      moderate: async () => ({ blocked: false, matches: [] }),
    });
    expect(result).toMatchObject({
      jobId: "job-1", previewJobId: "preview-job-123456",
      preview: { provider: "browser-bridge", externalId: CHARACTER_ID, name: "Theron" },
    });
    expect(harness.previewCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      userSessionId: "owner-session-1", externalId: CHARACTER_ID, canonicalSourceUrl: SOURCE_URL,
    }) }));
    expect(harness.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: "READY", payload: expect.anything(),
      preview: expect.objectContaining({ previewJobId: "preview-job-123456" }),
    }) }));
    const jobData = (harness.jobUpdate.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    expect(jobData.payload).toEqual(expect.objectContaining({}));
    expect(JSON.stringify(jobData.preview)).not.toContain('"rawData"');
  });

  it("rejects a racing second capture before creating a preview job", async () => {
    const harness = receiveHarness(0);
    await expect(receiveBridgeCharacter(fixedRandom(2)(32).toString("base64url"), envelope(), ARCHIVE_ORIGIN, {
      client: harness.client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      analyze: async () => ({ classification: "NO_MATCH", candidates: [] }),
      moderate: async () => ({ blocked: false, matches: [] }),
    })).rejects.toMatchObject({ code: "BRIDGE_REPLAY_REJECTED", status: 409 });
    expect(harness.previewCreate).not.toHaveBeenCalled();
  });

  it("rejects expired and already-consumed capabilities before creating a preview job", async () => {
    for (const mutate of [
      (harness: ReturnType<typeof receiveHarness>) => { harness.session.expiresAt = new Date(NOW.getTime() - 1); },
      (harness: ReturnType<typeof receiveHarness>) => { harness.session.consumedAt = NOW; },
    ]) {
      const harness = receiveHarness();
      mutate(harness);
      await expect(receiveBridgeCharacter(fixedRandom(2)(32).toString("base64url"), envelope(), ARCHIVE_ORIGIN, {
        client: harness.client, now: () => NOW, allowedArchiveOrigins: ALLOWED,
      })).rejects.toMatchObject({ status: expect.any(Number) });
      expect(harness.previewCreate).not.toHaveBeenCalled();
    }
  });

  it("returns only the owner-visible preview receipt from BridgeJob status", async () => {
    const preview = { name: "Theron", provider: "browser-bridge" };
    const findFirst = vi.fn(async () => ({
      id: "job-1", status: "READY", expiresAt: new Date(NOW.getTime() - 1), receivedAt: NOW,
      sourceUrl: SOURCE_URL, preview: { previewJobId: "preview-job-123456", preview }, savedCharacterId: null,
    }));
    const client = { bridgeJob: { findFirst } } as unknown as PrismaClient;
    await expect(getBridgeJob("owner-session-1", "job-1", { client, now: () => NOW })).resolves.toMatchObject({
      status: "READY", previewJobId: "preview-job-123456", preview,
    });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job-1", pairing: { userSessionId: "owner-session-1" } },
    }));
  });

  it("does not disclose a BridgeJob or ImportPreviewJob across Archive sessions", async () => {
    const client = { bridgeJob: { findFirst: vi.fn(async () => null) } } as unknown as PrismaClient;
    await expect(getBridgeJob("session-b", "job-owned-by-session-a", { client, now: () => NOW }))
      .rejects.toMatchObject({ code: "BRIDGE_JOB_NOT_FOUND", status: 404 });
  });
});
