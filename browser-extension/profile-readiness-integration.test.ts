import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const extensionRoot = resolve(process.cwd(), "browser-extension");
const manifest = JSON.parse(readFileSync(resolve(extensionRoot, "manifest.json"), "utf8")) as {
  content_scripts: Array<{ world: "MAIN" | "ISOLATED"; js: string[]; matches: string[]; all_frames?: boolean }>;
};
const RUNTIME_ID = "a".repeat(32);
const PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_URL = `https://janitorai.com/profiles/${PROFILE_ID}_profile-of-example-creator`;
const TARGET = {
  targetKind: "PROFILE", platform: "JANITOR_AI", profileId: PROFILE_ID,
  canonicalProfileUrl: `https://janitorai.com/profiles/${PROFILE_ID}`, pageOrigin: "https://janitorai.com",
};
const POPUP = { id: RUNTIME_ID, url: `chrome-extension://${RUNTIME_ID}/popup.html` };
const CONTENT = { id: RUNTIME_ID, url: PROFILE_URL, tab: { id: 9 } };

describe("profile readiness through production manifest boot order", () => {
  it("boots the real PROFILE MAIN and ISOLATED scripts, then restores the paired capability to READY without Janitor traffic", async () => {
    const harness = createBackgroundHarness();
    const document = createProfileDocument(1, (message) => harness.controller.handleMessage(message, CONTENT));
    harness.setDocument(document);
    await document.waitForBoot();

    expect(document.bootMessages).toContainEqual({
      contractVersion: 1,
      type: "PROFILE_CONTENT_READY",
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      documentNonce: "01".repeat(16),
    });

    await expect(harness.retry()).resolves.toMatchObject({
      phase: "READY",
      paired: true,
      pairedTargetKind: "PROFILE",
      contentScriptReachable: true,
      profileRetrievalReachable: true,
      profileDiscoverEnabled: true,
      readinessFailure: null,
      readinessDiagnostics: {
        extensionVersion: "0.1.5",
        contentReadyReceived: true,
        contentReadyContractVersion: 1,
        documentFingerprint: fingerprint("01".repeat(16)),
        documentGeneration: 1,
        documentStatus: "CURRENT",
        lastPingResult: "PING_OK",
        mainProbeResult: "MAIN_READY",
        currentReadinessState: "READY",
        safeError: null,
      },
    });
    expect(harness.sentMessages).toEqual([{ type: "PROFILE_ARCHIVE_PING", version: 1, targetKind: "PROFILE" }]);
    expect(harness.sentMessages).not.toContainEqual(expect.objectContaining({ type: "CHARACTER_ARCHIVE_PING" }));
    expect(document.janitorFetch).not.toHaveBeenCalled();
    expect(document.cookieRead).not.toHaveBeenCalled();
    expect(harness.archiveFetch).not.toHaveBeenCalled();
  });

  it("classifies an absent receiver, then reaches READY after declarative profile bootstrap", async () => {
    const harness = createBackgroundHarness();

    await expect(harness.retry()).resolves.toMatchObject({
      phase: "PAIRED_PAGE_RELOAD_REQUIRED",
      disabledReason: "CONTENT_SCRIPT_UNAVAILABLE",
      readinessFailure: "RECEIVER_MISSING",
    });

    const document = createProfileDocument(2, (message) => harness.controller.handleMessage(message, CONTENT));
    harness.setDocument(document);
    await document.waitForBoot();
    await expect(harness.retry()).resolves.toMatchObject({
      phase: "READY",
      profileDiscoverEnabled: true,
      readinessFailure: null,
      readinessDiagnostics: expect.objectContaining({
        contentReadyReceived: true,
        documentFingerprint: fingerprint("02".repeat(16)),
        documentGeneration: 1,
        lastPingResult: "PING_OK",
        mainProbeResult: "MAIN_READY",
      }),
    });
    expect(harness.archiveFetch).not.toHaveBeenCalled();
    expect(document.janitorFetch).not.toHaveBeenCalled();
  });

  it("keeps the capability across reload while Document B establishes a new nonce", async () => {
    const harness = createBackgroundHarness();
    const documentA = createProfileDocument(10, (message) => harness.controller.handleMessage(message, CONTENT));
    harness.setDocument(documentA);
    await documentA.waitForBoot();
    const readyA = await harness.retry();

    const documentB = createProfileDocument(11, (message) => harness.controller.handleMessage(message, CONTENT));
    harness.setDocument(documentB);
    await documentB.waitForBoot();
    const readyB = await harness.retry();

    expect(readyA).toMatchObject({ phase: "READY", capabilityPresent: true, readinessDiagnostics: { documentFingerprint: fingerprint("0a".repeat(16)), documentGeneration: 1 } });
    expect(readyB).toMatchObject({ phase: "READY", capabilityPresent: true, readinessDiagnostics: { documentFingerprint: fingerprint("0b".repeat(16)), documentGeneration: 2 } });
    expect(readyB.readinessDiagnostics).not.toEqual(readyA.readinessDiagnostics);
    expect(harness.archiveFetch).not.toHaveBeenCalled();
    expect(documentA.janitorFetch).not.toHaveBeenCalled();
    expect(documentB.janitorFetch).not.toHaveBeenCalled();
  });

  it("records PING_OK with MAIN_MISSING without collapsing the live boundary", async () => {
    const harness = createBackgroundHarness();
    harness.setDocument({ receive: async () => ({
      ok: true, version: 1, targetKind: "PROFILE", target: TARGET,
      documentNonce: "0c".repeat(16), receiverAlive: true,
      mainProbeResult: "MAIN_MISSING", profileRetrievalReachable: false,
    }) });

    await expect(harness.retry()).resolves.toMatchObject({
      phase: "PAIRED_PAGE_RELOAD_REQUIRED",
      contentScriptReachable: true,
      profileRetrievalReachable: false,
      readinessDiagnostics: {
        lastPingResult: "PING_OK",
        mainProbeResult: "MAIN_MISSING",
        documentStatus: "CURRENT",
        safeError: "MAIN_MISSING",
      },
    });
  });

  it("records TARGET_MISMATCH and exposes only the safe diagnostic DTO", async () => {
    const harness = createBackgroundHarness();
    const otherId = "00000000-0000-4000-8000-000000000002";
    const otherTarget = {
      targetKind: "PROFILE", platform: "JANITOR_AI", profileId: otherId,
      canonicalProfileUrl: `https://janitorai.com/profiles/${otherId}`, pageOrigin: "https://janitorai.com",
    };
    harness.setDocument({ receive: async () => ({
      ok: true, version: 1, targetKind: "PROFILE", target: otherTarget,
      documentNonce: "0d".repeat(16), receiverAlive: true,
      mainProbeResult: "MAIN_READY", profileRetrievalReachable: true,
    }) });

    const result = await harness.retry();
    expect(result).toMatchObject({
      phase: "PAIRED_PAGE_RELOAD_REQUIRED",
      readinessDiagnostics: { lastPingResult: "TARGET_MISMATCH", safeError: "TARGET_MISMATCH" },
    });
    const diagnostics = result.readinessDiagnostics as Record<string, unknown>;
    expect(Object.keys(diagnostics).sort()).toEqual([
      "contentReadyContractVersion", "contentReadyReceived", "currentReadinessState", "documentFingerprint",
      "documentGeneration", "documentStatus", "extensionVersion", "lastPingAttemptAt", "lastPingResult",
      "mainProbeResult", "pairedTargetKind", "safeError", "tabId", "targetId",
    ]);
    expect(JSON.stringify(diagnostics)).not.toMatch(/bridgeToken|pairingCode|jobId|authorization|cookie|header|session|payload/iu);
  });
});

function createBackgroundHarness() {
  const { contract, background } = loadBackgroundRuntime();
  const storageData: Record<string, unknown> = {
    characterArchiveCompanionStateV1: {
      session: {
        bridgeToken: "t".repeat(43), jobId: "profile-job", expiresAt: "2026-09-01T10:30:00.000Z",
        target: TARGET, tabId: 9,
      },
      armed: null,
      operation: null,
      profile: null,
      status: {
        phase: "PAIRED_PAGE_RELOAD_REQUIRED", code: "CONTENT_SCRIPT_UNAVAILABLE",
        message: "Paired. Reload this Janitor page, then Retry.",
      },
    },
  };
  let currentDocument: { receive(message: Record<string, unknown>): Promise<unknown> } | null = null;
  const sentMessages: Array<Record<string, unknown>> = [];
  const archiveFetch = vi.fn();
  const activeTab = { id: 9, windowId: 1, url: PROFILE_URL };
  const controller = background.createBackgroundController({
    config: { archiveOrigin: "http://localhost:3000", bridgeVersion: 1, operation: "CHARACTER_IMPORT" },
    contract,
    runtimeId: RUNTIME_ID,
    storage: {
      get: async (key: string) => ({ [key]: storageData[key] }),
      set: async (value: Record<string, unknown>) => { Object.assign(storageData, value); },
    },
    fetchImpl: archiveFetch,
    getActiveTab: async () => ({ tab: activeTab, queryResultCount: 1, windowId: 1 }),
    getBoundTab: async () => activeTab,
    sendTabMessage: async (_tabId: number, message: Record<string, unknown>) => {
      sentMessages.push(message);
      if (!currentDocument) throw new Error("Could not establish connection. Receiving end does not exist.");
      return currentDocument.receive(message);
    },
    hasSiteAccess: async () => true,
    scheduleExpiry: vi.fn(),
    clearExpiry: vi.fn(),
    now: () => new Date("2026-09-01T10:00:00.000Z").getTime(),
    wait: async () => undefined,
  });
  return {
    controller,
    archiveFetch,
    sentMessages,
    setDocument(value: { receive(message: Record<string, unknown>): Promise<unknown> }) { currentDocument = value; },
    retry: () => controller.handleMessage({ contractVersion: 1, type: "POPUP_RETRY_READY" }, POPUP),
  };
}

function createProfileDocument(seed: number, sendRuntimeMessage: (message: Record<string, unknown>) => Promise<unknown>) {
  type PageListener = (event: { source: unknown; origin: string; data: Record<string, unknown> }) => void;
  type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
  const mainListeners = new Set<PageListener>();
  const isolatedListeners = new Set<PageListener>();
  const bootMessages: Array<Record<string, unknown>> = [];
  const bootPromises: Array<Promise<unknown>> = [];
  let runtimeListener: RuntimeListener | null = null;
  const janitorFetch = vi.fn();
  const cookieRead = vi.fn(() => "");

  const dispatch = (value: Record<string, unknown>) => {
    dispatchTo(mainContext, mainListeners, value);
    dispatchTo(isolatedContext, isolatedListeners, value);
  };
  const base = (listeners: Set<PageListener>) => ({
    URL,
    TextEncoder,
    TextDecoder,
    Reflect,
    AbortController,
    location: { href: PROFILE_URL, origin: "https://janitorai.com" },
    setTimeout,
    clearTimeout,
    addEventListener(type: string, listener: PageListener) { if (type === "message") listeners.add(listener); },
    removeEventListener(type: string, listener: PageListener) { if (type === "message") listeners.delete(listener); },
    postMessage(value: Record<string, unknown>) { dispatch(value); },
  });
  const documentObject = {};
  Object.defineProperty(documentObject, "cookie", { get: cookieRead });
  const mainContext: Record<string, unknown> = {
    ...base(mainListeners),
    document: documentObject,
    fetch: janitorFetch,
    atob: (value: string) => Buffer.from(value, "base64").toString("utf8"),
    crypto: {
      getRandomValues(array: Uint8Array) { array.fill(seed); return array; },
      randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    },
    console: { debug: vi.fn() },
  };
  const isolatedContext: Record<string, unknown> = {
    ...base(isolatedListeners),
    crypto: {
      getRandomValues(array: Uint8Array) { array.fill(seed); return array; },
      randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    },
    console: { debug: vi.fn() },
    chrome: {
      runtime: {
        sendMessage(message: Record<string, unknown>) {
          bootMessages.push(message);
          const pending = sendRuntimeMessage(message);
          bootPromises.push(pending);
          return pending;
        },
        onMessage: { addListener(listener: RuntimeListener) { runtimeListener = listener; } },
      },
    },
  };
  Object.assign(mainContext, { globalThis: mainContext });
  Object.assign(isolatedContext, { globalThis: isolatedContext });

  for (const script of scriptsFor("MAIN")) runInNewContext(readFileSync(resolve(extensionRoot, script), "utf8"), mainContext);
  for (const script of scriptsFor("ISOLATED")) runInNewContext(readFileSync(resolve(extensionRoot, script), "utf8"), isolatedContext);
  if (!runtimeListener) throw new Error("Profile ISOLATED receiver was not installed by the manifest scripts.");

  return {
    bootMessages,
    janitorFetch,
    cookieRead,
    waitForBoot: () => Promise.all(bootPromises),
    receive(message: Record<string, unknown>) {
      return new Promise((resolveResponse) => {
        const keepPortOpen = runtimeListener?.(message, {}, resolveResponse);
        if (keepPortOpen !== true) resolveResponse(undefined);
      });
    },
  };
}

function dispatchTo(context: Record<string, unknown>, listeners: Set<(event: { source: unknown; origin: string; data: Record<string, unknown> }) => void>, value: Record<string, unknown>) {
  context.__messageListeners = listeners;
  context.__messageValue = value;
  runInNewContext("for (const listener of globalThis.__messageListeners) listener({ source: globalThis, origin: globalThis.location.origin, data: globalThis.__messageValue })", context);
}

function scriptsFor(world: "MAIN" | "ISOLATED") {
  const entry = manifest.content_scripts.find((candidate) => candidate.world === world);
  if (!entry || entry.all_frames !== false || !entry.matches.includes("https://janitorai.com/*")) throw new Error(`Missing ${world} manifest entry.`);
  return entry.js;
}

function loadBackgroundRuntime() {
  const context: Record<string, unknown> = { URL, TextEncoder };
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js", "lib/background-controller.js"]) {
    runInNewContext(readFileSync(resolve(extensionRoot, path), "utf8"), context);
  }
  return {
    contract: context.CharacterArchiveCompanionContract,
    background: context.CharacterArchiveCompanionBackground as {
      createBackgroundController(options: Record<string, unknown>): {
        handleMessage(message: unknown, sender: unknown): Promise<Record<string, unknown>>;
      };
    },
  };
}

function fingerprint(value: string) {
  let hash = 2166136261;
  for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
