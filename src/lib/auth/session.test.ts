import { describe, expect, it, vi } from "vitest";
import type { OwnerAuthConfig } from "./config";
import {
  authenticateOwnerSession,
  invalidateOwnerSession,
  isSameOriginWhenPresent,
  issueOwnerSession,
  type OwnerSessionStore,
} from "./session";

const config: OwnerAuthConfig = {
  username: "owner",
  passwordHash: "unused-in-session-tests",
  sessionSecret: "test-session-secret-that-is-longer-than-thirty-two-bytes",
};
const now = new Date("2026-08-17T00:00:00.000Z");
const sessionId = "8206dc9b-f75c-4d83-a3dd-cc8c60313762";

function createStore(): OwnerSessionStore & { records: Map<string, Date> } {
  const records = new Map<string, Date>();
  return {
    records,
    create: vi.fn(async (id, expiresAt) => { records.set(id, expiresAt); }),
    delete: vi.fn(async (id) => { records.delete(id); }),
    deleteExpired: vi.fn(async (date) => {
      for (const [id, expiresAt] of records) if (expiresAt <= date) records.delete(id);
    }),
    find: vi.fn(async (id) => {
      const expiresAt = records.get(id);
      return expiresAt ? { id, expiresAt } : null;
    }),
  };
}

describe("database-backed owner sessions", () => {
  it("creates and authenticates a new server-side session", async () => {
    const store = createStore();
    const session = await issueOwnerSession(config, { now, store, sessionId });
    await expect(authenticateOwnerSession(session.token, config.sessionSecret, { now, store })).resolves.toBe(true);
    expect(store.records.has(sessionId)).toBe(true);
  });

  it("invalidates the stored session on logout", async () => {
    const store = createStore();
    const session = await issueOwnerSession(config, { now, store, sessionId });
    await invalidateOwnerSession(session.token, config.sessionSecret, { now, store });
    await expect(authenticateOwnerSession(session.token, config.sessionSecret, { now, store })).resolves.toBe(false);
    expect(store.records.has(sessionId)).toBe(false);
  });

  it("rejects an expired or missing server-side session", async () => {
    const store = createStore();
    const session = await issueOwnerSession(config, { now, store, sessionId });
    const afterExpiry = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    await expect(authenticateOwnerSession(session.token, config.sessionSecret, { now: afterExpiry, store })).resolves.toBe(false);
    store.records.clear();
    await expect(authenticateOwnerSession(session.token, config.sessionSecret, { now, store })).resolves.toBe(false);
  });
});

describe("owner API same-origin validation", () => {
  it("accepts the browser origin when Next uses an internal bind address", () => {
    const request = new Request("http://0.0.0.0:3000/api/settings", {
      headers: {
        host: "192.168.1.16:3000",
        origin: "http://192.168.1.16:3000",
        "x-forwarded-host": "192.168.1.16:3000",
        "x-forwarded-proto": "http",
      },
    });

    expect(isSameOriginWhenPresent(request)).toBe(true);
  });

  it("rejects a different browser origin", () => {
    const request = new Request("https://internal.example/api/settings", {
      headers: {
        origin: "https://attacker.example",
        "x-forwarded-host": "archive.example",
        "x-forwarded-proto": "https",
      },
    });

    expect(isSameOriginWhenPresent(request)).toBe(false);
  });

  it("rejects a forwarded protocol mismatch", () => {
    const request = new Request("http://internal.example/api/settings", {
      headers: {
        origin: "http://archive.example",
        "x-forwarded-host": "archive.example",
        "x-forwarded-proto": "https",
      },
    });

    expect(isSameOriginWhenPresent(request)).toBe(false);
  });

  it("does not let a forwarded host override the request Host header", () => {
    const request = new Request("https://internal.example/api/settings", {
      headers: {
        host: "archive.example",
        origin: "https://attacker.example",
        "x-forwarded-host": "attacker.example",
        "x-forwarded-proto": "https",
      },
    });

    expect(isSameOriginWhenPresent(request)).toBe(false);
  });
});
