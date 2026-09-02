import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const PAGE_URL = `https://janitorai.com/characters/${CHARACTER_ID}_character-theron`;
const ENDPOINT = `https://janitorai.com/hampter/characters/${CHARACTER_ID}`;
const TARGET = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: CHARACTER_ID, canonicalSourceUrl: `https://janitorai.com/characters/${CHARACTER_ID}`, pageOrigin: "https://janitorai.com" };

describe("generic MAIN-world observer harness", () => {
  it("does not clone, parse, or retain a matching response before explicit ARM", async () => {
    const runtime = createRuntime();
    await runtime.context.fetch(ENDPOINT);
    expect(runtime.clone).not.toHaveBeenCalled();
    expect(runtime.messages.some((message) => message.type === "SOURCE_CHARACTER_CAPTURED")).toBe(false);

    runtime.arm();
    await runtime.context.fetch(ENDPOINT);
    await vi.waitFor(() => expect(runtime.messages.filter((message) => message.type === "SOURCE_CHARACTER_CAPTURED")).toHaveLength(1));
    expect(runtime.clone).toHaveBeenCalledOnce();
  });

  it("captures only the armed selected target once and restores native fetch", async () => {
    const runtime = createRuntime();
    const observedFetch = runtime.context.fetch;
    runtime.arm();
    await runtime.context.fetch(`https://janitorai.com/hampter/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80`);
    expect(runtime.clone).not.toHaveBeenCalled();
    await runtime.context.fetch(ENDPOINT);
    await vi.waitFor(() => expect(runtime.messages.filter((message) => message.type === "SOURCE_CHARACTER_CAPTURED")).toHaveLength(1));
    expect(runtime.context.fetch).not.toBe(observedFetch);
    await runtime.context.fetch(ENDPOINT);
    expect(runtime.clone).toHaveBeenCalledOnce();
  });

  it("answers a target-scoped readiness ping without arming", () => {
    const runtime = createRuntime();
    runtime.dispatch({
      channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "OBSERVER_PING",
      observerNonce: "b".repeat(32), target: TARGET,
    });
    expect(runtime.messages).toContainEqual(expect.objectContaining({ type: "OBSERVER_READY", observerNonce: "b".repeat(32), target: TARGET }));
    expect(runtime.clone).not.toHaveBeenCalled();
  });

  it("keeps Janitor endpoint matching in the isolated source observer", () => {
    const harness = readFileSync(resolve(process.cwd(), "browser-extension/core/observer-harness.js"), "utf8");
    const observer = readFileSync(resolve(process.cwd(), "browser-extension/observers/janitor.js"), "utf8");
    expect(harness).not.toContain("/hampter/");
    expect(observer).toContain("hampter");
  });

  it("fails closed without a registry instead of throwing into the page", () => {
    const nativeFetch = vi.fn(async () => ({ status: 200 }));
    const debug = vi.fn();
    const context: Record<string, unknown> = {
      URL, TextEncoder, Reflect,
      location: { href: PAGE_URL, origin: "https://janitorai.com" },
      fetch: nativeFetch,
      console: { debug },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
    };

    expect(() => {
      for (const path of ["core/contract.js", "core/observer-harness.js", "page-observer.js"]) {
        runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
      }
    }).not.toThrow();
    expect(context.fetch).toBe(nativeFetch);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith("[Character Archive Companion]", expect.objectContaining({
      event: "OBSERVER_INITIALIZATION_FAILED",
      code: "SOURCE_CONTRACT_CHANGED",
    }));
  });

  it("does not install an eligible capture on a non-Janitor page", () => {
    const nativeFetch = vi.fn(async () => ({ status: 200 }));
    const runtime = createRuntime({
      pageUrl: "https://janitorai.com/profiles/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      nativeFetch,
    });
    expect(runtime.context.fetch).toBe(nativeFetch);
    expect(runtime.messages).toHaveLength(0);
  });
});

function createRuntime(options: { pageUrl?: string; nativeFetch?: ReturnType<typeof vi.fn> } = {}) {
  let messageListener: ((event: Record<string, unknown>) => void) | null = null;
  const messages: Array<Record<string, unknown>> = [];
  const clone = vi.fn(() => ({ json: vi.fn(async () => ({ id: CHARACTER_ID, name: "Theron" })) }));
  const nativeFetch = options.nativeFetch ?? vi.fn(async () => ({ status: 200, clone }));
  const context: Record<string, unknown> = {
    URL, TextEncoder, Reflect,
    location: { href: options.pageUrl ?? PAGE_URL, origin: "https://janitorai.com" },
    fetch: nativeFetch,
    crypto: { randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f" },
    console: { debug: vi.fn() },
    addEventListener: (_type: string, listener: typeof messageListener) => { messageListener = listener; },
    removeEventListener: vi.fn(),
    postMessage: (value: Record<string, unknown>) => messages.push(value),
  };
  context.globalThis = context;
  for (const path of [
    "core/observer-registry.js", "observers/janitor.js", "core/contract.js",
    "core/observer-harness.js", "page-observer.js",
  ]) {
    runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  }
  runInNewContext("globalThis.__vmRoot = globalThis", context);
  const dispatch = (data: Record<string, unknown>) => messageListener?.({
    source: context.__vmRoot,
    origin: (context.location as { origin: string }).origin,
    data,
  });
  return {
    context: context as typeof context & { fetch: (input: string) => Promise<unknown> }, messages, clone, dispatch,
    arm: () => dispatch({ channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "ARM_SELECTED_TARGET", armNonce: "a".repeat(32), target: TARGET }),
  };
}
