import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const extensionRoot = resolve(process.cwd(), "browser-extension");
const manifest = JSON.parse(readFileSync(resolve(extensionRoot, "manifest.json"), "utf8")) as {
  manifest_version: number;
  version: string;
  permissions?: string[];
  host_permissions?: string[];
  content_scripts?: Array<{ matches: string[]; world?: string; run_at?: string; all_frames?: boolean; js: string[] }>;
};

describe("Character Archive Companion manifest", () => {
  it("uses Manifest V3 with only the required non-sensitive permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe("0.1.5");
    expect(manifest.permissions).toEqual(["alarms", "storage"]);
    expect(manifest.permissions).not.toEqual(expect.arrayContaining([
      "activeTab",
      "cookies",
      "debugger",
      "downloads",
      "history",
      "webRequest",
      "webRequestBlocking",
      "tabs",
      "scripting",
    ]));
  });

  it("allows only Janitor and the explicit local Archive host", () => {
    expect(manifest.host_permissions).toEqual([
      "https://janitorai.com/*",
      "https://www.janitorai.com/*",
      "http://localhost:3000/*",
    ]);
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest.host_permissions?.some((value) => value.includes("*://"))).toBe(false);
  });

  it("keeps the observer in MAIN and the forwarder in an isolated content world", () => {
    expect(manifest.content_scripts).toEqual([
      expect.objectContaining({ world: "MAIN", run_at: "document_start", all_frames: false, matches: [
        "https://janitorai.com/*", "https://www.janitorai.com/*",
      ], js: [
        "core/observer-registry.js", "observers/janitor.js", "core/active-adapter-registry.js",
        "core/contract.js", "adapters/janitor-active.js", "adapters/janitor-profile.js",
        "core/observer-harness.js", "core/active-retrieval-harness.js",
        "core/profile-retrieval-harness.js", "page-observer.js", "profile-page.js",
      ] }),
      expect.objectContaining({ world: "ISOLATED", run_at: "document_start", all_frames: false, matches: [
        "https://janitorai.com/*", "https://www.janitorai.com/*",
      ], js: [
        "core/observer-registry.js", "observers/janitor.js", "core/contract.js",
        "content-script.js", "profile-content-script.js",
      ] }),
    ]);
    expect(manifest.content_scripts?.every((entry) => entry.all_frames === undefined || entry.all_frames === false)).toBe(true);
  });

  it("declaratively injects both layers into the actual Theron-style character URL", () => {
    const theronUrl = "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron-dku-edition";
    for (const entry of manifest.content_scripts ?? []) {
      expect(entry.matches.some((pattern) => matchesPattern(theronUrl, pattern))).toBe(true);
    }
  });

  it("boots every MAIN-world dependency in manifest production order", () => {
    const nativeFetch = vi.fn(async () => ({ status: 200 }));
    const context: Record<string, unknown> = {
      URL,
      TextEncoder,
      TextDecoder,
      Reflect,
      AbortController,
      setTimeout,
      clearTimeout,
      atob: (value: string) => Buffer.from(value, "base64").toString("utf8"),
      document: { cookie: "" },
      location: {
        href: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron",
        origin: "https://janitorai.com",
      },
      fetch: nativeFetch,
      console: { debug: vi.fn() },
      crypto: { randomUUID: () => "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f" },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      postMessage: vi.fn(),
    };
    const scripts = manifest.content_scripts?.find(({ world }) => world === "MAIN")?.js ?? [];

    expect(() => {
      for (const script of scripts) {
        runInNewContext(readFileSync(resolve(extensionRoot, script), "utf8"), context);
      }
    }).not.toThrow();

    const registry = context.CharacterArchiveObserverRegistry as {
      all(): Array<{ platform: string }>;
      resolvePage(value: string): { target: { externalId: string } } | null;
    };
    expect(registry.all().map(({ platform }) => platform)).toEqual(["JANITOR_AI"]);
    expect(registry.resolvePage((context.location as { href: string }).href)?.target.externalId)
      .toBe("d7745ac8-8b75-48ec-aaf9-5699ad547cd7");
    expect(context.CharacterArchiveObserverHarness).toBeDefined();
    expect(context.fetch).not.toBe(nativeFetch);
  });

  it("boots every ISOLATED-world dependency in production order and answers a background PING", async () => {
    type PageListener = (event: { source: unknown; origin: string; data: Record<string, unknown> }) => void;
    type RuntimeListener = (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => unknown;
    const pageListeners = new Set<PageListener>();
    let runtimeListener: RuntimeListener | null = null;
    const context: Record<string, unknown> = {
      URL,
      TextEncoder,
      location: {
        href: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron",
        origin: "https://janitorai.com",
      },
      crypto: { getRandomValues: (array: Uint8Array) => (array.fill(7), array) },
      console: { debug: vi.fn() },
      setTimeout,
      clearTimeout,
      addEventListener(type: string, listener: PageListener) {
        if (type === "message") pageListeners.add(listener);
      },
      removeEventListener(type: string, listener: PageListener) {
        if (type === "message") pageListeners.delete(listener);
      },
      postMessage(value: Record<string, unknown>) {
        if (!["OBSERVER_PING", "ACTIVE_RETRIEVAL_PING"].includes(value.type as string)) return;
        context.__observerResponse = { ...value, type: value.type === "OBSERVER_PING" ? "OBSERVER_READY" : "ACTIVE_RETRIEVAL_READY" };
        context.__pageListeners = pageListeners;
        runInNewContext(
          "for (const listener of globalThis.__pageListeners) listener({ source: globalThis, origin: globalThis.location.origin, data: globalThis.__observerResponse })",
          context,
        );
      },
      chrome: {
        runtime: {
          sendMessage: vi.fn(async () => ({ arm: false })),
          onMessage: { addListener(listener: RuntimeListener) { runtimeListener = listener; } },
        },
      },
    };
    Object.assign(context, { globalThis: context });
    const scripts = manifest.content_scripts?.find(({ world }) => world === "ISOLATED")?.js ?? [];

    for (const script of scripts) runInNewContext(readFileSync(resolve(extensionRoot, script), "utf8"), context);

    const receive = runtimeListener as RuntimeListener | null;
    if (!receive) throw new Error("ISOLATED content-script listener was not installed.");
    const sendResponse = vi.fn();
    expect(receive({ type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      version: 1,
      targetKind: "CHARACTER",
      observerReachable: true,
      activeRetrievalReachable: true,
      observerArmed: false,
    })));
  });
});

function matchesPattern(urlValue: string, pattern: string) {
  const url = new URL(urlValue);
  const match = /^(https?):\/\/([^/]+)(\/.*)$/u.exec(pattern);
  if (!match) return false;
  return url.protocol === `${match[1]}:` && url.hostname === match[2] && (
    match[3] === "/*" || url.pathname.startsWith(match[3].slice(0, -1))
  );
}
