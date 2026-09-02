import { describe, expect, it } from "vitest";
import {
  authenticateUserSession,
  invalidateUserSession,
  issueUserSession,
  requireAdminApiSession,
  type UserSessionStore,
} from "./session";
import { hashUserSessionToken } from "./session-token";

const NOW = new Date("2026-08-17T00:00:00.000Z");
const TOKEN = "A".repeat(43);

function createStore(
  accessStatus: "ACTIVE" | "REVOKED" = "ACTIVE",
  role: "ADMIN" | "MEMBER" = "ADMIN",
): UserSessionStore & {
  records: Map<string, { id: string; userId: string; expiresAt: Date }>;
} {
  const records = new Map<string, { id: string; userId: string; expiresAt: Date }>();
  return {
    records,
    async create(tokenHash, userId, expiresAt) {
      const value = { id: "user-session-1", userId, expiresAt };
      records.set(tokenHash, value);
      return { id: value.id };
    },
    async deleteByTokenHash(tokenHash) {
      records.delete(tokenHash);
    },
    async deleteExpired(now) {
      for (const [hash, session] of records) if (session.expiresAt <= now) records.delete(hash);
    },
    async findByTokenHash(tokenHash) {
      const session = records.get(tokenHash);
      return session ? {
        id: session.id,
        expiresAt: session.expiresAt,
        user: {
          userId: session.userId,
          username: "admin@example.com",
          displayName: "Admin",
          role,
          accessStatus,
        },
      } : null;
    },
  };
}

describe("database-backed user sessions", () => {
  it("stores only a token hash and returns the safe principal", async () => {
    const store = createStore();
    const issued = await issueUserSession("initial-admin", { now: NOW, store, token: TOKEN });
    expect(issued.sessionId).toBe("user-session-1");
    expect(store.records.has(TOKEN)).toBe(false);
    expect(store.records.has(hashUserSessionToken(TOKEN))).toBe(true);
    await expect(authenticateUserSession(TOKEN, { now: NOW, store })).resolves.toMatchObject({
      sessionId: "user-session-1",
      principal: {
        userId: "initial-admin",
        username: "admin@example.com",
        displayName: "Admin",
        role: "ADMIN",
      },
    });
  });

  it("invalidates only the presented session", async () => {
    const store = createStore();
    await issueUserSession("initial-admin", { now: NOW, store, token: TOKEN });
    await invalidateUserSession(TOKEN, { store });
    await expect(authenticateUserSession(TOKEN, { now: NOW, store })).resolves.toBeNull();
  });

  it("rejects expired, revoked, malformed, and legacy owner sessions", async () => {
    const activeStore = createStore();
    const issued = await issueUserSession("initial-admin", { now: NOW, store: activeStore, token: TOKEN });
    await expect(authenticateUserSession(TOKEN, {
      now: new Date(issued.expiresAt.getTime() + 1),
      store: activeStore,
    })).resolves.toBeNull();

    const revokedStore = createStore("REVOKED");
    await issueUserSession("initial-admin", { now: NOW, store: revokedStore, token: TOKEN });
    await expect(authenticateUserSession(TOKEN, { now: NOW, store: revokedStore })).resolves.toBeNull();
    await expect(authenticateUserSession("payload.signature", { now: NOW, store: activeStore })).resolves.toBeNull();
    await expect(authenticateUserSession(undefined, { now: NOW, store: activeStore })).resolves.toBeNull();
  });

  it("distinguishes unauthenticated 401 from authenticated non-admin 403", async () => {
    const noSession = await requireAdminApiSession(new Request("http://localhost/api/settings"), { store: createStore() });
    expect(noSession?.status).toBe(401);

    const memberStore = createStore("ACTIVE", "MEMBER");
    await issueUserSession("member-1", { now: NOW, store: memberStore, token: TOKEN });
    const member = await requireAdminApiSession(requestWithToken(), { now: NOW, store: memberStore });
    expect(member?.status).toBe(403);

    const adminStore = createStore();
    await issueUserSession("initial-admin", { now: NOW, store: adminStore, token: TOKEN });
    await expect(requireAdminApiSession(requestWithToken(), { now: NOW, store: adminStore })).resolves.toBeNull();
  });

  it("treats a revoked user's otherwise valid API session as unauthenticated", async () => {
    const store = createStore("REVOKED");
    await issueUserSession("initial-admin", { now: NOW, store, token: TOKEN });
    const response = await requireAdminApiSession(requestWithToken(), { now: NOW, store });
    expect(response?.status).toBe(401);
  });
});

function requestWithToken(): Request {
  return new Request("http://localhost/api/settings", {
    headers: { cookie: `character_archive_user_session=${TOKEN}` },
  });
}
