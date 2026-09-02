import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const RUNTIME_ID = "a".repeat(32);
const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const PAGE_URL = `https://janitorai.com/characters/${CHARACTER_ID}_character-theron`;
const TARGET = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: CHARACTER_ID, canonicalSourceUrl: `https://janitorai.com/characters/${CHARACTER_ID}`, pageOrigin: "https://janitorai.com" };
const POPUP = { id: RUNTIME_ID, url: `chrome-extension://${RUNTIME_ID}/popup.html` };
const CONTENT = { id: RUNTIME_ID, url: PAGE_URL, tab: { id: 7 } };

describe("generic companion background capability", () => {
  it("recognizes the exact active character before pairing", async () => {
    const harness = createHarness();
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({
        paired: false,
        profileTarget: false,
        selectedTargetKind: "CHARACTER",
        selectedExternalId: CHARACTER_ID,
        message: "Pair this Janitor character to retrieve it.",
      });
    expect(harness.fetchImpl).not.toHaveBeenCalled();
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
  });

  it("pairs without retrieval, then explicitly retrieves the exact target and sends one generic envelope", async () => {
    const harness = createHarness();
    const paired = await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    expect(paired).toMatchObject({ paired: true, selectedPlatform: "JANITOR_AI", selectedExternalId: CHARACTER_ID });
    const exchange = JSON.parse((harness.fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    expect(exchange).toEqual({ pairingCode: "0101010101010101", bridgeVersion: 1, operation: "CHARACTER_IMPORT", target: TARGET });
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRIEVE_SELECTED" }, POPUP)).resolves.toMatchObject({ phase: "RETRIEVING" });
    expect(harness.sendTabMessage).toHaveBeenCalledWith(7, { contractVersion: 1, type: "RETRIEVE_SELECTED_CHARACTER", target: TARGET });

    const sent = await harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_CAPTURE", capture: capture() }, CONTENT);
    expect(sent).toMatchObject({ phase: "SENT", capabilityPresent: false });
    const imported = JSON.parse((harness.fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(imported).toMatchObject({
      bridgeVersion: 1, observerContractVersion: 1, platform: "JANITOR_AI",
      source: { url: TARGET.canonicalSourceUrl }, payload: { id: CHARACTER_ID, name: "Theron" },
    });
  });

  it("rejects untrusted popup and unarmed capture messages", async () => {
    const harness = createHarness();
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, { ...POPUP, id: "b".repeat(32) }))
      .resolves.toMatchObject({ ok: false, code: "UNTRUSTED_EXTENSION_SENDER" });
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_CAPTURE", capture: capture() }, CONTENT))
      .resolves.toMatchObject({ ok: false, code: "CAPTURE_NOT_OBSERVED" });
    expect(harness.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a profile capability exchange on a character page", async () => {
    const profileId = "9502024d-a6b5-4348-b556-31a37fbd6f2a";
    const harness = createHarness({ exchangeTarget: {
      targetKind: "PROFILE", platform: "JANITOR_AI", profileId,
      canonicalProfileUrl: `https://janitorai.com/profiles/${profileId}`,
      pageOrigin: "https://janitorai.com",
    } });

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP))
      .resolves.toMatchObject({ ok: false, paired: false, code: "PAIRING_FAILED" });
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
  });

  it("never arms or sends from a different character tab", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    harness.activeTab.url = "https://janitorai.com/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80_character-other";
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRIEVE_SELECTED" }, POPUP))
      .resolves.toMatchObject({ sendEnabled: false, disabledReason: "WRONG_CHARACTER" });
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-arms only the persisted tab and immutable target after reload", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_SEND_SELECTED" }, POPUP);
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_READY", target: TARGET }, CONTENT))
      .resolves.toEqual({ arm: true, target: TARGET });
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "CONTENT_READY", target: TARGET }, { ...CONTENT, tab: { id: 8 } }))
      .resolves.toEqual({ arm: false });
  });

  it("clears the session-scoped token on expiry", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    await harness.controller.handleExpiryAlarm("character-archive-companion-expiry");
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({ phase: "EXPIRED", capabilityPresent: false });
  });

  it("retains the exact paired tab across an unavailable old page and reaches READY on non-arming Retry", async () => {
    const harness = createHarness();
    harness.sendTabMessage.mockRejectedValue(new Error("Could not establish connection. Receiving end does not exist."));

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP))
      .resolves.toMatchObject({
        phase: "PAIRED_PAGE_RELOAD_REQUIRED",
        paired: true,
        boundTabId: 7,
        retryEnabled: true,
        disabledReason: "CONTENT_SCRIPT_UNAVAILABLE",
      });
    expect(harness.sendTabMessage).toHaveBeenCalledTimes(3);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);

    harness.sendTabMessage.mockReset().mockResolvedValue({
      ok: true, version: 1, targetKind: "CHARACTER", target: TARGET, observerReachable: true, activeRetrievalReachable: true, observerArmed: false,
    });
    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRY_READY" }, POPUP))
      .resolves.toMatchObject({ phase: "READY", sendEnabled: true, boundTabId: 7 });
    expect(harness.sendTabMessage).toHaveBeenCalledExactlyOnceWith(7, { type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" });
    expect(harness.sendTabMessage).not.toHaveBeenCalledWith(7, expect.objectContaining({ type: "ARM_SELECTED_TARGET" }));
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails Retry with WRONG_CHARACTER without retargeting or messaging Character B", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    harness.activeTab.url = "https://janitorai.com/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80_character-other";
    harness.sendTabMessage.mockClear();

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRY_READY" }, POPUP))
      .resolves.toMatchObject({ paired: true, disabledReason: "WRONG_CHARACTER", sendEnabled: false, retryEnabled: false });
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails Retry with WRONG_PAGE after the bound tab leaves Janitor", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    harness.activeTab.url = "https://example.com/not-janitor";
    harness.sendTabMessage.mockClear();

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRY_READY" }, POPUP))
      .resolves.toMatchObject({ paired: true, disabledReason: "WRONG_PAGE", sendEnabled: false, retryEnabled: false });
    expect(harness.sendTabMessage).not.toHaveBeenCalled();
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reopens from session storage and checks the originally paired tab without a new exchange", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    harness.sendTabMessage.mockClear();

    await expect(harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_GET_STATE" }, POPUP))
      .resolves.toMatchObject({ phase: "READY", capabilityPresent: true, boundTabId: 7, sendEnabled: true });
    expect(harness.sendTabMessage).toHaveBeenCalledExactlyOnceWith(7, { type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" });
    expect(harness.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a second retrieval while the first operation is active", async () => {
    const harness = createHarness();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_PAIR", pairingCode: "0101-0101-0101-0101" }, POPUP);
    harness.sendTabMessage.mockClear();
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRIEVE_SELECTED" }, POPUP);
    await harness.controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRIEVE_SELECTED" }, POPUP);
    expect(harness.sendTabMessage).toHaveBeenCalledTimes(2);
    expect(harness.sendTabMessage.mock.calls.filter(([, message]) => message.type === "RETRIEVE_SELECTED_CHARACTER")).toHaveLength(1);
  });
});

function capture() {
  return {
    messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f", capturedAt: "2026-08-24T10:00:00.000Z",
    target: TARGET, observerContractVersion: 1, payload: { id: CHARACTER_ID, name: "Theron" },
  };
}

function createHarness({ exchangeTarget = TARGET }: { exchangeTarget?: Record<string, unknown> } = {}) {
  const { contract, background } = loadRuntime();
  const expiresAt = "2026-08-24T10:10:00.000Z";
  const storageData: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: storageData[key] })),
    set: vi.fn(async (value: Record<string, unknown>) => Object.assign(storageData, value)),
  };
  const fetchImpl = vi.fn(async (...args: [string, RequestInit?]) => args[0].endsWith("/pair/exchange")
    ? response({ bridgeToken: "t".repeat(43), jobId: "job-1", expiresAt, target: exchangeTarget })
    : response({ jobId: "job-1", previewJobId: "preview-job-123456", status: "READY" }, 202));
  const activeTab = { id: 7, windowId: 1, url: PAGE_URL };
  const sendTabMessage = vi.fn(async (_tabId: number, message: Record<string, unknown>) => message.type === "CHARACTER_ARCHIVE_PING"
    ? { ok: true, version: 1, targetKind: "CHARACTER", target: TARGET, observerReachable: true, activeRetrievalReachable: true, observerArmed: false }
    : message.type === "RETRIEVE_SELECTED_CHARACTER"
      ? { ok: true, version: 1, accepted: true, target: TARGET }
      : { ok: true, version: 1, armed: true, target: TARGET, observerReachable: true });
  const controller = background.createBackgroundController({
    config: { archiveOrigin: "http://localhost:3000", bridgeVersion: 1, operation: "CHARACTER_IMPORT" },
    contract, runtimeId: RUNTIME_ID, storage, fetchImpl,
    getActiveTab: async () => ({ tab: activeTab, queryResultCount: 1, windowId: 1 }),
    getBoundTab: async (id: number) => id === activeTab.id ? activeTab : null,
    sendTabMessage, hasSiteAccess: async () => true,
    scheduleExpiry: vi.fn(), clearExpiry: vi.fn(), now: () => new Date("2026-08-24T10:00:00.000Z").getTime(),
    wait: async () => undefined,
  });
  return { controller, fetchImpl, sendTabMessage, activeTab };
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function loadRuntime() {
  const context: Record<string, unknown> = { URL, TextEncoder };
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js", "lib/background-controller.js"]) {
    runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  }
  return {
    contract: context.CharacterArchiveCompanionContract,
    background: context.CharacterArchiveCompanionBackground as { createBackgroundController(options: Record<string, unknown>): { handleMessage(message: unknown, sender: unknown): Promise<Record<string, unknown>>; handleExpiryAlarm(name: string): Promise<unknown> } },
  };
}
