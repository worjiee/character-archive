import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface BridgeHelpers {
  isRawPageContext(sandboxMode: unknown): boolean;
  selectedCharacterId(pathname: string): string | null;
  matchesCharacterResponse(input: {
    requestUrl: string;
    method: string;
    status: number;
    contentType: string;
    selectedId: string;
  }): boolean;
  containsForbiddenTransportKey(value: unknown): boolean;
  createChannelNonce(cryptoApi: Pick<Crypto, "getRandomValues">): string;
  createReceiverUrl(archiveOrigin: string, channelNonce: string): string;
  isStoredChannelState(value: unknown, now: number): boolean;
  validateArchiveReceiverMessage(value: unknown, channelNonce: string): Record<string, unknown> | null;
}

const SCRIPT_PATH = resolve(process.cwd(), "scripts/janitor-browser-bridge.user.js");
const SCRIPT_SOURCE = readFileSync(SCRIPT_PATH, "utf8");
const requireFromTest = createRequire(import.meta.url);
const helpers = requireFromTest(SCRIPT_PATH) as BridgeHelpers;
const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const CHARACTER_PATH = `/characters/${CHARACTER_ID}_character-theron`;
const ENDPOINT = `https://janitorai.com/hampter/characters/${CHARACTER_ID}`;
const ARCHIVE_ORIGIN = "http://localhost:3000";
const NONCE = "01".repeat(16);
const EXPIRES_AT = "2099-01-01T00:00:00.000Z";

describe("Janitor browser bridge companion", () => {
  it("uses Tampermonkey's reported sandbox mode for fail-closed page-context detection", () => {
    expect(helpers.isRawPageContext("raw")).toBe(true);
    expect(helpers.isRawPageContext("js")).toBe(false);
    expect(helpers.isRawPageContext("dom")).toBe(false);
    expect(helpers.isRawPageContext(undefined)).toBe(false);
  });

  it("selects only the UUID from a Janitor character page path", () => {
    expect(helpers.selectedCharacterId(CHARACTER_PATH)).toBe(CHARACTER_ID);
    expect(helpers.selectedCharacterId(`/profiles/${CHARACTER_ID}`)).toBeNull();
  });

  it("captures only the exact successful JSON character response", () => {
    expect(helpers.matchesCharacterResponse({
      requestUrl: ENDPOINT,
      method: "GET",
      status: 200,
      contentType: "application/json; charset=utf-8",
      selectedId: CHARACTER_ID,
    })).toBe(true);
  });

  it.each([
    ["unrelated request", "https://janitorai.com/api/me", "GET", 200, "application/json"],
    ["non-character endpoint", `https://janitorai.com/hampter/profiles/${CHARACTER_ID}`, "GET", 200, "application/json"],
    ["non-GET", ENDPOINT, "POST", 200, "application/json"],
    ["non-2xx", ENDPOINT, "GET", 403, "application/json"],
    ["non-JSON", ENDPOINT, "GET", 200, "text/html"],
    ["wrong origin", `https://attacker.example/hampter/characters/${CHARACTER_ID}`, "GET", 200, "application/json"],
  ])("ignores %s", (_label, requestUrl, method, status, contentType) => {
    expect(helpers.matchesCharacterResponse({
      requestUrl,
      method,
      status,
      contentType,
      selectedId: CHARACTER_ID,
    })).toBe(false);
  });

  it("uses structural credential-shaped rejection without false positives in prose", () => {
    expect(helpers.containsForbiddenTransportKey({ description: "A token of appreciation." })).toBe(false);
    expect(helpers.containsForbiddenTransportKey({ nested: { authorization: "secret" } })).toBe(true);
  });

  it("builds a random channel and the exact configured receiver URL", () => {
    const cryptoApi = {
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(1);
        return bytes;
      }),
    } as Pick<Crypto, "getRandomValues">;
    const nonce = helpers.createChannelNonce(cryptoApi);
    expect(nonce).toBe(NONCE);
    expect(helpers.createReceiverUrl(ARCHIVE_ORIGIN, nonce))
      .toBe(`${ARCHIVE_ORIGIN}/bridge/receiver#channel=${NONCE}`);
    expect(() => helpers.createReceiverUrl(`${ARCHIVE_ORIGIN}/unexpected`, nonce)).toThrow();
  });

  it("opens the receiver only after the explicit button click and pairs through exact-origin messaging", async () => {
    const receiver = receiverWindow();
    const runtime = await runCompanion({
      nativeFetch: vi.fn(async () => Response.json({ ok: true })),
      receiver,
    });

    expect(runtime.open).not.toHaveBeenCalled();
    runtime.dispatch("DOMContentLoaded", {});
    runtime.clickBridgeButton();
    expect(runtime.open).toHaveBeenCalledOnce();
    expect(runtime.open).toHaveBeenCalledWith(
      `${ARCHIVE_ORIGIN}/bridge/receiver#channel=${NONCE}`,
      `character-archive-bridge-${NONCE}`,
      expect.not.stringMatching(/noopener|noreferrer/u),
    );

    runtime.dispatch("message", {
      origin: ARCHIVE_ORIGIN,
      source: receiver,
      data: { channelVersion: 1, type: "RECEIVER_READY", channelNonce: NONCE },
    });
    expect(receiver.postMessage).toHaveBeenCalledWith({
      channelVersion: 1,
      type: "CHANNEL_OPEN",
      channelNonce: NONCE,
    }, ARCHIVE_ORIGIN);
    expect(receiver.close).not.toHaveBeenCalled();

    runtime.dispatch("message", {
      origin: ARCHIVE_ORIGIN,
      source: receiver,
      data: { channelVersion: 1, type: "PAIR_RESULT", channelNonce: NONCE, ok: true, expiresAt: EXPIRES_AT },
    });
    await vi.waitFor(() => expect(runtime.gmSetValue).toHaveBeenCalled());
    expect(runtime.gmSetValue).toHaveBeenCalledWith(expect.any(String), {
      channelNonce: NONCE,
      expiresAt: EXPIRES_AT,
    });
    expect(JSON.stringify(runtime.gmSetValue.mock.calls)).not.toContain("bridgeToken");
  });

  it("rejects wrong origins, sources, nonces, and malformed receiver messages", async () => {
    const receiver = receiverWindow();
    const runtime = await runCompanion({
      nativeFetch: vi.fn(async () => Response.json({ ok: true })),
      receiver,
    });
    runtime.dispatch("DOMContentLoaded", {});
    runtime.clickBridgeButton();
    const valid = { channelVersion: 1, type: "RECEIVER_READY", channelNonce: NONCE };
    runtime.dispatch("message", { origin: "https://attacker.example", source: receiver, data: valid });
    runtime.dispatch("message", { origin: ARCHIVE_ORIGIN, source: {}, data: valid });
    runtime.dispatch("message", { origin: ARCHIVE_ORIGIN, source: receiver, data: { ...valid, channelNonce: "f".repeat(32) } });
    runtime.dispatch("message", { origin: ARCHIVE_ORIGIN, source: receiver, data: { type: "RECEIVER_READY" } });
    expect(receiver.postMessage).not.toHaveBeenCalled();
    expect(receiver.close).not.toHaveBeenCalled();
  });

  it("keeps the receiver open when pairing fails", async () => {
    const receiver = receiverWindow();
    const runtime = await runCompanion({
      nativeFetch: vi.fn(async () => Response.json({ ok: true })),
      receiver,
    });
    runtime.dispatch("DOMContentLoaded", {});
    runtime.clickBridgeButton();
    runtime.dispatch("message", {
      origin: ARCHIVE_ORIGIN,
      source: receiver,
      data: { channelVersion: 1, type: "PAIR_RESULT", channelNonce: NONCE, ok: false, errorCode: "INVALID_PAIRING" },
    });
    await vi.waitFor(() => expect(runtime.gmDeleteValue).toHaveBeenCalledOnce());
    expect(receiver.close).not.toHaveBeenCalled();
  });

  it("returns Janitor's original response unchanged, relays one clone, and removes observation", async () => {
    const payload = { id: CHARACTER_ID, name: "Theron" };
    const janitorResponse = Response.json(payload);
    const nativeFetch = vi.fn(async () => janitorResponse);
    const receiver = receiverWindow();
    const runtime = await runCompanion({ nativeFetch, armed: true, receiver });
    await vi.waitFor(() => expect(runtime.root.fetch).not.toBe(nativeFetch));

    runtime.dispatch("message", {
      origin: ARCHIVE_ORIGIN,
      source: receiver,
      data: { channelVersion: 1, type: "RECEIVER_PAIRED", channelNonce: NONCE, expiresAt: EXPIRES_AT },
    });
    const returned = await runtime.root.fetch(ENDPOINT);
    expect(returned).toBe(janitorResponse);
    await expect(returned.json()).resolves.toEqual(payload);
    await vi.waitFor(() => expect(receiver.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CHARACTER_ENVELOPE",
        channelNonce: NONCE,
        envelope: expect.objectContaining({ payload }),
      }),
      ARCHIVE_ORIGIN,
    ));
    expect(runtime.root.fetch).toBe(nativeFetch);

    await runtime.root.fetch(ENDPOINT);
    expect(receiver.postMessage).toHaveBeenCalledTimes(1);
    runtime.dispatch("message", {
      origin: ARCHIVE_ORIGIN,
      source: receiver,
      data: { channelVersion: 1, type: "IMPORT_RESULT", channelNonce: NONCE, ok: true },
    });
    await vi.waitFor(() => expect(runtime.gmDeleteValue).toHaveBeenCalledOnce());
    expect(receiver.close).not.toHaveBeenCalled();
  });

  it("does not install observation outside a valid UUID character page or raw page world", async () => {
    const nativeFetch = vi.fn(async () => Response.json({ ok: true }));
    const wrongPage = await runCompanion({ nativeFetch, pathname: "/characters/not-a-character", armed: true });
    const wrongWorld = await runCompanion({ nativeFetch, sandboxMode: "js", armed: true });
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    expect(wrongPage.root.fetch).toBe(nativeFetch);
    expect(wrongWorld.root.fetch).toBe(nativeFetch);
  });

  it("contains no direct Archive fetch, wildcard messaging, privileged networking, or credential-store access", () => {
    expect(SCRIPT_SOURCE).toContain("// @sandbox      raw");
    expect(SCRIPT_SOURCE).toContain("// @noframes");
    expect(SCRIPT_SOURCE).not.toContain("@grant        unsafeWindow");
    expect(SCRIPT_SOURCE).not.toContain("GM_xmlhttpRequest");
    expect(SCRIPT_SOURCE).not.toContain("/api/bridge/pair/exchange");
    expect(SCRIPT_SOURCE).not.toContain("/api/bridge/import");
    expect(SCRIPT_SOURCE).not.toMatch(/postMessage\([^)]*,\s*["']\*["']/u);
    expect(SCRIPT_SOURCE).not.toContain("document.cookie");
    expect(SCRIPT_SOURCE).not.toContain("root.localStorage");
    expect(SCRIPT_SOURCE).not.toContain("root.sessionStorage");
    expect(SCRIPT_SOURCE).not.toContain("root.indexedDB");
    expect(SCRIPT_SOURCE).not.toContain("input.headers");
    expect(SCRIPT_SOURCE).not.toContain("init.headers");
    expect(SCRIPT_SOURCE).not.toContain("owner_session");
    expect(SCRIPT_SOURCE).not.toContain("root.prompt");
    expect(SCRIPT_SOURCE).not.toContain("receiverWindow.close");
  });
});

function receiverWindow() {
  return { postMessage: vi.fn(), close: vi.fn() };
}

async function runCompanion({
  nativeFetch,
  pathname = CHARACTER_PATH,
  sandboxMode = "raw",
  armed = false,
  receiver = receiverWindow(),
}: {
  nativeFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  pathname?: string;
  sandboxMode?: "raw" | "js" | "dom";
  armed?: boolean;
  receiver?: ReturnType<typeof receiverWindow>;
}) {
  const listeners = new Map<string, Array<(event: never) => void>>();
  const elements: Array<Record<string, unknown>> = [];
  const messageElement = { style: {}, textContent: "", id: "" };
  const document = {
    createElement: vi.fn((tagName: string) => {
      const handlers = new Map<string, () => void>();
      const element = {
        tagName,
        style: {},
        textContent: "",
        id: "",
        type: "",
        addEventListener: vi.fn((type: string, handler: () => void) => handlers.set(type, handler)),
        append: vi.fn(),
        click: () => handlers.get("click")?.(),
      };
      elements.push(element);
      return element;
    }),
    getElementById: vi.fn((id: string) => id === "character-archive-bridge-message" ? messageElement : null),
    body: { append: vi.fn() },
  };
  const open = vi.fn(() => receiver);
  const gmSetValue = vi.fn(async () => undefined);
  const gmDeleteValue = vi.fn(async () => undefined);
  const root = {
    document,
    location: {
      origin: "https://janitorai.com",
      pathname,
      href: `https://janitorai.com${pathname}`,
    },
    crypto: {
      randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(1);
        return bytes;
      },
    },
    fetch: nativeFetch,
    open,
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn((type: string, handler: (event: never) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    }),
  };
  const context = vm.createContext({
    window: root,
    GM_info: { sandboxMode },
    URL,
    URLSearchParams,
    Request,
    Response,
    TextEncoder,
    Uint8Array,
    Date,
    setTimeout,
    clearTimeout,
    GM_getValue: vi.fn(async () => armed ? ({ channelNonce: NONCE, expiresAt: EXPIRES_AT }) : null),
    GM_setValue: gmSetValue,
    GM_deleteValue: gmDeleteValue,
  });
  vm.runInContext(SCRIPT_SOURCE, context, { filename: SCRIPT_PATH });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));

  return {
    root,
    open,
    gmSetValue,
    gmDeleteValue,
    dispatch(type: string, event: unknown) {
      for (const handler of listeners.get(type) ?? []) handler(event as never);
    },
    clickBridgeButton() {
      const button = elements.find((element) => element.tagName === "button") as { click(): void } | undefined;
      if (!button) throw new Error("Bridge button was not installed.");
      button.click();
    },
  };
}
