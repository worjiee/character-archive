import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const TARGET = {
  targetKind: "CHARACTER",
  platform: "JANITOR_AI",
  externalId: ID,
  canonicalSourceUrl: `https://janitorai.com/characters/${ID}`,
  pageOrigin: "https://janitorai.com",
};
const ENDPOINT = `https://janitorai.com/hampter/characters/${ID}`;
const AUTH_SENTINEL = "synthetic-secret-never-transport";

describe("Janitor browser-local active adapter", () => {
  it("performs no request when loaded or probed and constructs only the exact target endpoint on retrieve", async () => {
    const runtime = loadAdapter();
    expect(runtime.defaultFetch).not.toHaveBeenCalled();

    const fetchImpl = vi.fn(async () => jsonResponse(character()));
    const adapter = runtime.createAdapter({ fetchImpl, readCookie: authCookie });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(adapter.retrieveCharacter(TARGET)).resolves.toMatchObject({
      status: "RETRIEVED",
      payload: { id: ID, name: "Theron" },
    });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(ENDPOINT, expect.objectContaining({
      method: "GET",
      credentials: "include",
      redirect: "manual",
      signal: expect.any(Object),
    }));
  });

  it("rejects a caller-supplied different target before any network request", async () => {
    const runtime = loadAdapter();
    const fetchImpl = vi.fn();
    const adapter = runtime.createAdapter({ fetchImpl, readCookie: authCookie });

    await expect(adapter.retrieveCharacter({ ...TARGET, externalId: "62650d46-bcda-4eac-90a5-1162cb3d5d80" }))
      .resolves.toEqual({ status: "FAILED", code: "WRONG_CHARACTER" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps browser-local authorization out of the returned result", async () => {
    const runtime = loadAdapter();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${AUTH_SENTINEL}`);
      return jsonResponse(character());
    });
    const result = await runtime.createAdapter({ fetchImpl, readCookie: authCookie }).retrieveCharacter(TARGET);

    expect(JSON.stringify(result)).not.toContain(AUTH_SENTINEL);
    expect(JSON.stringify(result)).not.toMatch(/authorization|cookie|headers/iu);
    expect(runtime.debug).not.toHaveBeenCalled();
  });

  it.each([
    [401, "AUTH_REQUIRED", 1],
    [403, "AUTH_REQUIRED", 1],
    [404, "NOT_FOUND", 1],
    [429, "RATE_LIMITED", 3],
    [502, "SOURCE_UNAVAILABLE", 3],
    [503, "SOURCE_UNAVAILABLE", 3],
    [504, "SOURCE_UNAVAILABLE", 3],
  ] as const)("maps HTTP %s to %s with bounded attempts", async (status, code, attempts) => {
    const runtime = loadAdapter();
    const fetchImpl = vi.fn(async () => response(status));
    const adapter = runtime.createAdapter({ fetchImpl, readCookie: authCookie, wait: async () => undefined });

    await expect(adapter.retrieveCharacter(TARGET)).resolves.toEqual({ status: "FAILED", code });
    expect(fetchImpl).toHaveBeenCalledTimes(attempts);
  });

  it("maps a bounded attempt timeout after initial plus two retries", async () => {
    const runtime = loadAdapter();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const adapter = runtime.createAdapter({
      fetchImpl,
      readCookie: authCookie,
      wait: async () => undefined,
      setTimer: (callback: () => void) => (queueMicrotask(callback), 1),
      clearTimer: () => undefined,
    });

    await expect(adapter.retrieveCharacter(TARGET)).resolves.toEqual({ status: "FAILED", code: "RETRIEVAL_TIMEOUT" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["oversized", () => jsonResponse(character(), { "content-length": String(1024 * 1024 + 1) })],
    ["malformed JSON", () => textResponse(200, "{not-json", "application/json")],
    ["wrong UUID", () => jsonResponse(character({ id: "62650d46-bcda-4eac-90a5-1162cb3d5d80" }))],
    ["credential-shaped payload", () => jsonResponse(character({ access_token: AUTH_SENTINEL }))],
  ])("rejects %s as INVALID_SOURCE_PAYLOAD", async (_label, makeResponse) => {
    const runtime = loadAdapter();
    const adapter = runtime.createAdapter({ fetchImpl: vi.fn(async () => makeResponse()), readCookie: authCookie });
    await expect(adapter.retrieveCharacter(TARGET)).resolves.toEqual({ status: "FAILED", code: "INVALID_SOURCE_PAYLOAD" });
  });

  it("fails closed on content-type drift and redirects", async () => {
    const runtime = loadAdapter();
    const html = runtime.createAdapter({ fetchImpl: vi.fn(async () => textResponse(200, "<html></html>", "text/html")), readCookie: authCookie });
    const redirect = runtime.createAdapter({ fetchImpl: vi.fn(async () => response(302, { location: "https://evil.example/" })), readCookie: authCookie });
    await expect(html.retrieveCharacter(TARGET)).resolves.toEqual({ status: "FAILED", code: "SOURCE_CONTRACT_CHANGED" });
    await expect(redirect.retrieveCharacter(TARGET)).resolves.toEqual({ status: "FAILED", code: "SOURCE_CONTRACT_CHANGED" });
  });

  it("returns AUTH_REQUIRED without fetching when the page has no usable session", async () => {
    const runtime = loadAdapter();
    const fetchImpl = vi.fn();
    const adapter = runtime.createAdapter({ fetchImpl, readCookie: () => "" });
    await expect(adapter.retrieveCharacter(TARGET)).resolves.toEqual({ status: "FAILED", code: "AUTH_REQUIRED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

function character(overrides: Record<string, unknown> = {}) {
  return { id: ID, name: "Theron", first_message: "Hello", custom_tags: ["#Fantasy"], ...overrides };
}

function authCookie() {
  const encoded = Buffer.from(JSON.stringify({ access_token: AUTH_SENTINEL })).toString("base64");
  return `sb-auth-auth-token=base64-${encoded}`;
}

function response(status: number, headers: Record<string, string> = {}) {
  return textResponse(status, "", "application/json", headers);
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return textResponse(200, JSON.stringify(body), "application/json; charset=utf-8", headers);
}

function textResponse(status: number, body: string, contentType: string, headers: Record<string, string> = {}) {
  const normalized = new Map(Object.entries({ "content-type": contentType, ...headers }).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    url: ENDPOINT,
    headers: { get: (key: string) => normalized.get(key.toLowerCase()) ?? null },
    text: async () => body,
  };
}

function loadAdapter() {
  const defaultFetch = vi.fn();
  const debug = vi.fn();
  const context: Record<string, unknown> = {
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch: defaultFetch,
    document: { cookie: "" },
    location: { href: `${TARGET.canonicalSourceUrl}_character-theron`, origin: TARGET.pageOrigin },
    atob: (value: string) => Buffer.from(value, "base64").toString("utf8"),
    console: { debug },
  };
  Object.assign(context, { globalThis: context });
  for (const path of [
    "core/observer-registry.js",
    "observers/janitor.js",
    "core/active-adapter-registry.js",
    "core/contract.js",
    "adapters/janitor-active.js",
  ]) runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  const api = context.CharacterArchiveJanitorActiveAdapter as { createAdapter(dependencies?: Record<string, unknown>): { retrieveCharacter(target: unknown): Promise<Record<string, unknown>> } };
  return { createAdapter: api.createAdapter, defaultFetch, debug };
}
