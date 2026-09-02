import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const SOURCE_URL = `https://janitorai.com/characters/${CHARACTER_ID}_character-theron`;
const TARGET = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: CHARACTER_ID, canonicalSourceUrl: `https://janitorai.com/characters/${CHARACTER_ID}`, pageOrigin: "https://janitorai.com" };
const CONTENT_SOURCE = readFileSync(resolve(process.cwd(), "browser-extension/content-script.js"), "utf8");

describe("isolated Janitor content-script readiness", () => {
  it("answers the direct ping with the selected UUID after the MAIN observer responds", async () => {
    const runtime = contentRuntime({ observerAvailable: true });
    const sendResponse = vi.fn();

    expect(runtime.receive({ type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      version: 1,
      targetKind: "CHARACTER",
      target: TARGET,
      observerReachable: true,
      activeRetrievalReachable: true,
      observerArmed: false,
    });
    expect(runtime.postedTypes()).toContain("OBSERVER_PING");
  });

  it("uses sendResponse for an exact arm acknowledgment and does not require prior arming", async () => {
    const runtime = contentRuntime({ observerAvailable: true });
    const sendResponse = vi.fn();

    expect(runtime.receive({
      contractVersion: 1,
      type: "ARM_SELECTED_TARGET",
      target: TARGET,
    }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith({
      ok: true,
      version: 1,
      armed: true,
      target: TARGET,
      observerReachable: true,
    });
    expect(runtime.postedTypes()).toContain("ARM_SELECTED_TARGET");
  });

  it("re-arms the MAIN observer and acknowledges completion when a new document resumes a binding", async () => {
    const runtime = contentRuntime({ observerAvailable: true, resumeArm: true });

    await vi.waitFor(() => expect(runtime.runtimeMessages()).toContainEqual({
      contractVersion: 1,
      type: "CONTENT_ARMED",
      target: TARGET,
    }));
    expect(runtime.postedTypes()).toContain("ARM_SELECTED_TARGET");

    const sendResponse = vi.fn();
    expect(runtime.receive({ type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      observerReachable: true,
      observerArmed: true,
    })));
  });

  it("distinguishes an unavailable MAIN observer from an unavailable content script", async () => {
    const runtime = contentRuntime({ observerAvailable: false });
    const pingResponse = vi.fn();
    expect(runtime.receive({ type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" }, pingResponse)).toBe(true);
    runtime.expireObserverChecks();
    await vi.waitFor(() => expect(pingResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      observerReachable: false,
    })));

    const armResponse = vi.fn();
    expect(runtime.receive({
      contractVersion: 1,
      type: "ARM_SELECTED_TARGET",
      target: TARGET,
    }, armResponse)).toBe(true);
    runtime.expireObserverChecks();
    await vi.waitFor(() => expect(armResponse).toHaveBeenCalledWith({
      ok: false,
      version: 1,
      armed: false,
      target: TARGET,
      observerReachable: false,
      code: "UNSUPPORTED_CAPTURE_METHOD",
    }));
  });

  it("forwards only the validated active result after an explicit retrieval command", async () => {
    const payload = { id: CHARACTER_ID, name: "Theron", custom_tags: ["#Fantasy"] };
    const runtime = contentRuntime({ observerAvailable: true, retrievePayload: payload });
    const sendResponse = vi.fn();

    expect(runtime.receive({ contractVersion: 1, type: "RETRIEVE_SELECTED_CHARACTER", target: TARGET }, sendResponse)).toBeUndefined();
    expect(sendResponse).toHaveBeenCalledWith({ ok: true, version: 1, accepted: true, target: TARGET });
    await vi.waitFor(() => expect(runtime.runtimeMessages()).toContainEqual(expect.objectContaining({
      contractVersion: 1,
      type: "CONTENT_CAPTURE",
      capture: expect.objectContaining({ target: TARGET, payload }),
    })));
    expect(runtime.postedTypes()).toContain("RETRIEVE_SELECTED_CHARACTER");
  });

  it("rejects pings and arm messages outside the narrow contracts", () => {
    const runtime = contentRuntime({ observerAvailable: true });
    expect(runtime.receive({ type: "CHARACTER_ARCHIVE_PING", version: 2, targetKind: "CHARACTER" }, vi.fn())).toBeUndefined();
    expect(runtime.receive({
      contractVersion: 1,
      type: "ARM_SELECTED_TARGET",
      target: { ...TARGET, externalId: "62650d46-bcda-4eac-90a5-1162cb3d5d80" },
    }, vi.fn())).toBeUndefined();
  });

  it("does not reference Janitor credentials, storage, or privileged networking", () => {
    expect(CONTENT_SOURCE).not.toMatch(/Authorization|document\.cookie|localStorage|sessionStorage|indexedDB/iu);
    expect(CONTENT_SOURCE).not.toMatch(/\bfetch\b|XMLHttpRequest|GM_xmlhttpRequest|chrome\.storage/iu);
  });
});

function contentRuntime({
  observerAvailable,
  resumeArm = false,
  retrievePayload,
}: {
  observerAvailable: boolean;
  resumeArm?: boolean;
  retrievePayload?: Record<string, unknown>;
}) {
  type PageListener = (event: { source: unknown; origin: string; data: unknown }) => void;
  type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
  const pageListeners = new Set<PageListener>();
  const timers = new Map<number, () => void>();
  const posted: Array<Record<string, unknown>> = [];
  const runtimeMessages: Array<Record<string, unknown>> = [];
  let nextTimer = 1;
  let runtimeListener: RuntimeListener | null = null;
  const context: Record<string, unknown> = {
    URL,
    TextEncoder,
    location: {
      href: SOURCE_URL,
      origin: "https://janitorai.com",
    },
    crypto: {
      getRandomValues(array: Uint8Array) {
        array.fill(10);
        return array;
      },
      randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    },
    setTimeout(callback: () => void) {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id: number) {
      timers.delete(id);
    },
    addEventListener(type: string, listener: PageListener) {
      if (type === "message") pageListeners.add(listener);
    },
    removeEventListener(type: string, listener: PageListener) {
      if (type === "message") pageListeners.delete(listener);
    },
    postMessage(value: Record<string, unknown>) {
      posted.push(value);
      if (!observerAvailable) return;
      const response = value.type === "OBSERVER_PING"
        ? { ...value, type: "OBSERVER_READY" }
        : value.type === "ACTIVE_RETRIEVAL_PING"
          ? { ...value, type: "ACTIVE_RETRIEVAL_READY" }
        : value.type === "ARM_SELECTED_TARGET"
          ? { ...value, type: "OBSERVER_ARMED" }
          : value.type === "RETRIEVE_SELECTED_CHARACTER" && retrievePayload
            ? {
                channel: "CHARACTER_ARCHIVE_COMPANION",
                version: 1,
                type: "ACTIVE_RETRIEVAL_RESULT",
                operationNonce: value.operationNonce,
                target: TARGET,
                status: "RETRIEVED",
                observerContractVersion: 1,
                payload: retrievePayload,
              }
          : null;
      if (!response) return;
      context.__observerResponse = response;
      context.__pageListeners = pageListeners;
      runInNewContext(
        "for (const listener of globalThis.__pageListeners) listener({ source: globalThis, origin: globalThis.location.origin, data: globalThis.__observerResponse })",
        context,
      );
    },
    chrome: {
      runtime: {
        sendMessage: vi.fn(async (message: Record<string, unknown>) => {
          runtimeMessages.push(message);
          if (message.type === "CONTENT_READY") {
            return resumeArm ? { arm: true, target: TARGET } : { arm: false };
          }
          return { ok: true };
        }),
        onMessage: {
          addListener(listener: RuntimeListener) {
            runtimeListener = listener;
          },
        },
      },
    },
  };
  Object.assign(context, { globalThis: context });
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js", "content-script.js"]) {
    runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  }
  if (!runtimeListener) throw new Error("Content-script listener was not installed.");

  return {
    receive(message: unknown, sendResponse: (response: unknown) => void) {
      return runtimeListener?.(message, {}, sendResponse);
    },
    expireObserverChecks() {
      for (const callback of [...timers.values()]) callback();
    },
    postedTypes: () => posted.map((value) => value.type),
    runtimeMessages: () => runtimeMessages,
  };
}
