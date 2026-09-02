import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const PROFILE_ID = "9502024d-a6b5-4348-b556-31a37fbd6f2a";
const PROFILE_URL = `https://janitorai.com/profiles/${PROFILE_ID}`;
const COOKIE = `sb-auth-auth-token=base64-${Buffer.from(JSON.stringify({ access_token: "synthetic-browser-only-token" })).toString("base64")}`;

describe("Janitor profile browser-local adapter", () => {
  it("discovers sequential listing pages, deduplicates exact UUIDs, and stops on an empty page", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => uuid(index + 1));
    const fetchImpl = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return jsonResponse(url, page === 1
        ? { total: 20, data: [...ids.slice(0, 12).map(listing), listing(ids[0]!)] }
        : page === 2 ? { total: 20, data: ids.slice(12).map(listing) } : { total: 20, data: [] });
    });
    const adapter = loadAdapter().createAdapter({ fetchImpl, readCookie: () => COOKIE });
    const result = await adapter.discoverProfile(target());

    expect(result).toMatchObject({ status: "DISCOVERED", reportedTotal: 20, truncated: false });
    expect(result.items).toHaveLength(20);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("page"))).toEqual(["1", "2"]);
    for (const [url] of fetchImpl.mock.calls) {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/hampter/characters");
      expect(parsed.searchParams.getAll("user_id[]")).toEqual([PROFILE_ID]);
      expect(parsed.searchParams.get("language")).toBe("en");
      expect(parsed.searchParams.get("sort")).toBe("latest");
    }
  });

  it("returns a truthful first-100 truncation without fetching character details", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => uuid(index + 1));
    const fetchImpl = vi.fn(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return jsonResponse(url, { total: 120, data: page === 1 ? ids.slice(0, 60).map(listing) : ids.slice(60).map(listing) });
    });
    const adapter = loadAdapter().createAdapter({ fetchImpl, readCookie: () => COOKIE });
    const result = await adapter.discoverProfile(target());

    expect(result).toMatchObject({ status: "DISCOVERED", reportedTotal: 120, truncated: true });
    expect(result.items).toHaveLength(100);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([url]) => new URL(String(url)).pathname === "/hampter/characters")).toBe(true);
  });

  it("retries one bounded 429 listing response and never transfers its authorization value", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse("https://janitorai.com/hampter/characters?page=1&language=en&sort=latest&user_id%5B%5D=" + PROFILE_ID, {}, 429, { "retry-after": "0" }))
      .mockImplementationOnce(async (url: string) => jsonResponse(url, { total: 1, data: [listing(uuid(1))] }));
    const waits: number[] = [];
    const adapter = loadAdapter().createAdapter({ fetchImpl, readCookie: () => COOKIE, wait: async (ms: number) => { waits.push(ms); } });
    const result = await adapter.discoverProfile(target());

    expect(result.status).toBe("DISCOVERED");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([0]);
    expect(JSON.stringify(result)).not.toContain("synthetic-browser-only-token");
  });

  it("retrieves only discovered selected IDs with maximum concurrency two and isolates failures", async () => {
    const ids = [uuid(1), uuid(2), uuid(3), uuid(4)];
    let active = 0; let maximum = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/hampter/characters") return jsonResponse(url, { total: ids.length, data: ids.map(listing) });
      active += 1; maximum = Math.max(maximum, active);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      active -= 1;
      const id = parsed.pathname.split("/").at(-1)!;
      return id === ids[1] ? jsonResponse(url, {}, 404) : jsonResponse(url, { id, name: `Character ${id.slice(-2)}` });
    });
    const adapter = loadAdapter().createAdapter({ fetchImpl, readCookie: () => COOKIE });
    await adapter.discoverProfile(target());
    const results: Array<[string, { status: string; code?: string }]> = [];
    const result = await adapter.retrieveSelected(target(), [ids[0], ids[1], ids[3]], async (id: string, value: { status: string; code?: string }) => { results.push([id, value]); });

    expect(result.status).toBe("COMPLETE");
    expect(maximum).toBe(2);
    expect(results).toHaveLength(3);
    expect(results.find(([id]) => id === ids[1])?.[1]).toMatchObject({ status: "FAILED", code: "NOT_FOUND" });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith(ids[2]!))).toBe(false);
    await expect(adapter.retrieveSelected(target(), [uuid(99)], vi.fn())).resolves.toMatchObject({ status: "FAILED", code: "UNDISCOVERED_CHARACTER" });
  });

  it("cancels a safe in-flight discovery and stops scheduling pages", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }));
    const adapter = loadAdapter().createAdapter({ fetchImpl, readCookie: () => COOKIE });
    const pending = adapter.discoverProfile(target());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    adapter.cancel();
    await expect(pending).resolves.toMatchObject({ status: "FAILED", code: "CANCELLED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function loadAdapter() {
  const context: Record<string, unknown> = {
    URL, TextEncoder, TextDecoder, AbortController, setTimeout, clearTimeout,
    atob: (value: string) => Buffer.from(value, "base64").toString("utf8"),
    document: { cookie: COOKIE }, fetch: vi.fn(), console: { debug: vi.fn() },
  };
  for (const file of [
    "core/observer-registry.js", "observers/janitor.js", "core/active-adapter-registry.js",
    "core/contract.js", "adapters/janitor-active.js", "adapters/janitor-profile.js",
  ]) runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", file), "utf8"), context);
  return context.CharacterArchiveJanitorProfileAdapter as { createAdapter(dependencies: Record<string, unknown>): ProfileAdapterTest };
}
interface ProfileAdapterTest {
  discoverProfile(targetValue: ReturnType<typeof target>): Promise<{ status: string; code?: string; items: Array<{ externalId: string }>; reportedTotal: number | null; truncated: boolean }>;
  retrieveSelected(targetValue: ReturnType<typeof target>, selectedIds: string[], onResult: (id: string, value: { status: string; code?: string }) => Promise<void>): Promise<{ status: string; code?: string }>;
  cancel(): void;
}
function target() { return { targetKind: "PROFILE", platform: "JANITOR_AI", profileId: PROFILE_ID, canonicalProfileUrl: PROFILE_URL, pageOrigin: "https://janitorai.com" }; }
function uuid(index: number) { return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`; }
function listing(id: string) { return { id, name: `Character ${id.slice(-2)}`, creator_name: "owner", avatar: `https://img.example/${id}` }; }
function jsonResponse(url: string, payload: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  const headers = new Map(Object.entries({ "content-type": "application/json", ...extraHeaders }));
  return { status, url, headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null }, text: async () => JSON.stringify(payload) };
}
