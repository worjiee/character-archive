import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const RUNTIME_ID = "a".repeat(32);
const PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_URL = `https://janitorai.com/profiles/${PROFILE_ID}`;
const PROFILE_PAGE_URL = `${PROFILE_URL}_profile-of-example-creator`;
const TARGET = { targetKind: "PROFILE", platform: "JANITOR_AI", profileId: PROFILE_ID, canonicalProfileUrl: PROFILE_URL, pageOrigin: "https://janitorai.com" };
const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const POPUP = { id: RUNTIME_ID, url: `chrome-extension://${RUNTIME_ID}/popup.html` };
const CONTENT = { id: RUNTIME_ID, url: PROFILE_PAGE_URL, tab: { id: 9 } };

describe("profile companion background coordination", () => {
  it("recognizes the exact active profile before pairing without starting discovery", async () => {
    const harness = createHarness();

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({
        paired: false,
        profileTarget: true,
        selectedTargetKind: "PROFILE",
        selectedProfileId: PROFILE_ID,
        message: "Pair this Janitor profile to discover its characters.",
      });
    expect(harness.fetchImpl).not.toHaveBeenCalled();
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
  });

  it("preserves PROFILE through pairing, popup reopen, and service-worker restoration", async () => {
    const storageData: Record<string, unknown> = {};
    const first = createHarness({ storageData });

    await expect(first.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({ paired: false, selectedTargetKind: "PROFILE" });
    await expect(first.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP))
      .resolves.toMatchObject({ phase: "READY", pairedTargetKind: "PROFILE", profileDiscoverEnabled: true });
    expect(first.sendTabMessage).toHaveBeenCalledWith(9, { type: "PROFILE_ARCHIVE_PING", version: 1, targetKind: "PROFILE" });
    expect(first.sendTabMessage).not.toHaveBeenCalledWith(9, expect.objectContaining({ type: "CHARACTER_ARCHIVE_PING" }));
    expect(first.sendTabMessage).not.toHaveBeenCalledWith(9, expect.objectContaining({ type: "RETRIEVE_SELECTED_CHARACTER" }));
    expect(storageData.characterArchiveCompanionStateV1).toMatchObject({
      session: { target: TARGET, tabId: 9 },
    });
    await expect(first.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({ phase: "READY", pairedTargetKind: "PROFILE", profileDiscoverEnabled: true });

    const restarted = createHarness({ storageData });
    await expect(restarted.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({ phase: "READY", pairedTargetKind: "PROFILE", profileDiscoverEnabled: true });
    expect(restarted.fetchImpl).not.toHaveBeenCalled();
  });

  it("discards a legacy stored session without targetKind instead of defaulting to CHARACTER", async () => {
    const legacyTarget = {
      platform: TARGET.platform,
      profileId: TARGET.profileId,
      canonicalProfileUrl: TARGET.canonicalProfileUrl,
      pageOrigin: TARGET.pageOrigin,
    };
    const storageData: Record<string, unknown> = {
      characterArchiveCompanionStateV1: {
        session: { bridgeToken: "t".repeat(43), jobId: "legacy", expiresAt: "2026-08-30T12:10:00.000Z", target: legacyTarget, tabId: 9 },
        armed: null, operation: null, profile: null, status: { phase: "PAIRED", message: "Legacy pairing" },
      },
    };
    const harness = createHarness({ storageData });

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({
        paired: false,
        code: "INVALID_PAIRING_TARGET",
        selectedTargetKind: "PROFILE",
        pairedTargetKind: null,
      });
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
  });

  it("requires explicit discovery and retrieval actions, survives popup closure, and sends only discovered detail data", async () => {
    const harness = createHarness();
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP))
      .resolves.toMatchObject({ phase: "READY", profileTarget: true, profileDiscoverEnabled: true });
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_DISCOVER_PROFILE" }, POPUP))
      .resolves.toMatchObject({ phase: "PROFILE_DISCOVERING" });
    expect(harness.sendTabMessage).toHaveBeenCalledWith(9, { contractVersion: 1, type: "DISCOVER_PROFILE_CHARACTERS", target: TARGET });
    await harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_PROFILE_DISCOVERY", target: TARGET, result: { status: "DISCOVERED", items: [{ externalId: CHARACTER_ID, name: "Theron", avatarUrl: null, creatorName: "owner", createdAt: null, updatedAt: null }], reportedTotal: 1, truncated: false } }, CONTENT);

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({ phase: "PROFILE_DISCOVERED", profile: { discovered: 1 } });
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRIEVE_PROFILE_SELECTED" }, POPUP))
      .resolves.toMatchObject({ phase: "PROFILE_RETRIEVING", profile: { selected: 1 } });

    await harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_PROFILE_DETAIL", target: TARGET, externalId: CHARACTER_ID, result: { status: "RETRIEVED", payload: { id: CHARACTER_ID, name: "Theron" } } }, CONTENT);
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_PROFILE_COMPLETE", target: TARGET, result: { status: "COMPLETE" } }, CONTENT))
      .resolves.toMatchObject({ phase: "PROFILE_REVIEW", profile: { ready: 1, failed: 0 } });

    const requests = harness.fetchImpl.mock.calls.map(([url, init]) => ({ url: String(url), body: String((init as RequestInit | undefined)?.body ?? "") }));
    expect(requests.some(({ url }) => url.endsWith("/api/bridge/extension/profile/batch"))).toBe(true);
    expect(requests.some(({ url }) => url.endsWith("/api/bridge/extension/profile/complete"))).toBe(true);
    expect(JSON.stringify(requests)).not.toContain("authorization");
    expect(JSON.stringify(requests)).not.toContain("cookie");
  });

  it("rejects a profile detail result for an ID absent from discovery", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_DISCOVER_PROFILE" }, POPUP);
    await harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_PROFILE_DISCOVERY", target: TARGET, result: { status: "DISCOVERED", items: [{ externalId: CHARACTER_ID, name: "Theron" }], reportedTotal: 1, truncated: false } }, CONTENT);
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRIEVE_PROFILE_SELECTED" }, POPUP);
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_PROFILE_DETAIL", target: TARGET, externalId: "62650d46-bcda-4eac-90a5-1162cb3d5d80", result: { status: "RETRIEVED", payload: { id: "62650d46-bcda-4eac-90a5-1162cb3d5d80", name: "Forged" } } }, CONTENT))
      .resolves.toMatchObject({ ok: false, code: "UNDISCOVERED_CHARACTER" });
    expect(harness.fetchImpl.mock.calls.some(([url]) => String(url).endsWith("/profile/batch"))).toBe(false);
  });

  it("rejects a character capability exchange on a profile page", async () => {
    const harness = createHarness({ exchangeTarget: {
      targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: CHARACTER_ID,
      canonicalSourceUrl: `https://janitorai.com/characters/${CHARACTER_ID}`,
      pageOrigin: "https://janitorai.com",
    } });

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP))
      .resolves.toMatchObject({ ok: false, paired: false, code: "PAIRING_FAILED" });
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
  });

  it("rejects a capability for Profile B on Profile A", async () => {
    const otherId = "62650d46-bcda-4eac-90a5-1162cb3d5d80";
    const harness = createHarness({ exchangeTarget: {
      targetKind: "PROFILE", platform: "JANITOR_AI", profileId: otherId,
      canonicalProfileUrl: `https://janitorai.com/profiles/${otherId}`,
      pageOrigin: "https://janitorai.com",
    } });

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP))
      .resolves.toMatchObject({ ok: false, paired: false, code: "PAIRING_FAILED" });
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
  });

  it("uses profile-specific copy when the bound tab moves to Profile B", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    harness.activeTab.url = "https://janitorai.com/profiles/00000000-0000-4000-8000-000000000002_profile-of-example-creator";

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({
        pairedTargetKind: "PROFILE",
        disabledReason: "WRONG_PROFILE",
        message: "This pairing belongs to a different Janitor profile.",
      });
  });
});

function createHarness({
  exchangeTarget = TARGET,
  storageData = {},
}: {
  exchangeTarget?: Record<string, unknown>;
  storageData?: Record<string, unknown>;
} = {}) {
  const { contract, background } = loadRuntime();
  const storage = { get: vi.fn(async (key: string) => ({ [key]: storageData[key] })), set: vi.fn(async (value: Record<string, unknown>) => Object.assign(storageData, value)) };
  const fetchImpl = vi.fn(async (...args: [string, RequestInit?]) => {
    const [url] = args;
    if (url.endsWith("/pair/exchange")) return response({ bridgeToken: "t".repeat(43), jobId: "profile-job", expiresAt: "2026-08-30T12:10:00.000Z", target: exchangeTarget });
    if (url.endsWith("/profile/selection")) return response({ selectedIds: [CHARACTER_ID] });
    if (url.endsWith("/profile/batch")) return response({ results: [{ externalId: CHARACTER_ID, status: "PREVIEW_READY", previewJobId: "preview-1" }] }, 202);
    return response({ ok: true }, 202);
  });
  const activeTab = { id: 9, windowId: 1, url: PROFILE_PAGE_URL };
  const sendTabMessage = vi.fn(async (_id: number, message: Record<string, unknown>) => message.type === "PROFILE_ARCHIVE_PING"
    ? { ok: true, version: 1, targetKind: "PROFILE", target: TARGET, documentNonce: "a".repeat(32), receiverAlive: true, mainProbeResult: "MAIN_READY", profileRetrievalReachable: true }
    : { ok: true, version: 1, accepted: true, target: TARGET });
  const controller = background.createBackgroundController({
    config: { archiveOrigin: "http://localhost:3000", bridgeVersion: 1, operation: "CHARACTER_IMPORT" }, contract, runtimeId: RUNTIME_ID, storage, fetchImpl,
    getActiveTab: async () => ({ tab: activeTab, queryResultCount: 1, windowId: 1 }), getBoundTab: async () => activeTab, sendTabMessage,
    hasSiteAccess: async () => true, scheduleExpiry: vi.fn(), clearExpiry: vi.fn(), now: () => new Date("2026-08-30T12:00:00.000Z").getTime(), wait: async () => undefined,
  });
  return { controller, fetchImpl, sendTabMessage, activeTab };
}
function response(body: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body } as Response; }
function loadRuntime() {
  const context: Record<string, unknown> = { URL, TextEncoder, crypto: { randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f" } };
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js", "lib/background-controller.js"]) runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  return { contract: context.CharacterArchiveCompanionContract, background: context.CharacterArchiveCompanionBackground as { createBackgroundController(options: Record<string, unknown>): { handleMessage(message: unknown, sender: unknown): Promise<Record<string, unknown>> } } };
}
