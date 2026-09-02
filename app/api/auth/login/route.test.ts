import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ findUnique: vi.fn() }));
const auth = vi.hoisted(() => {
  class PasswordHashError extends Error {}
  return {
    issueUserSession: vi.fn(),
    LEGACY_OWNER_SESSION_COOKIE: "character_archive_session",
    loginRateLimiter: {
      check: vi.fn(() => ({ limited: false, retryAfterSeconds: 0 })),
      clear: vi.fn(),
      recordFailure: vi.fn(),
    },
    loginRateLimitKey: vi.fn(() => "client"),
    normalizeUsername: vi.fn((value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US")),
    PasswordHashError,
    safePostLoginRedirect: vi.fn(() => "/characters"),
    USER_SESSION_COOKIE: "character_archive_user_session",
    userSessionCookieOptions: vi.fn((expiresAt: Date) => ({ httpOnly: true, sameSite: "strict", path: "/", expires: expiresAt })),
    verifyPassword: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: database.findUnique } } }));
vi.mock("@/src/lib/auth", () => auth);

import { POST } from "./route";

const ACTIVE_ADMIN = { id: "initial-admin", passwordHash: "stored-hash", accessStatus: "ACTIVE" };
const ACTIVE_MEMBER = { id: "member-1", passwordHash: "member-hash", accessStatus: "ACTIVE" };

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.loginRateLimiter.check.mockReturnValue({ limited: false, retryAfterSeconds: 0 });
    auth.issueUserSession.mockResolvedValue({
      token: "A".repeat(43),
      sessionId: "user-session-1",
      expiresAt: new Date("2026-08-28T08:00:00.000Z"),
    });
  });

  it("normalizes username and creates a UserSession for a valid ACTIVE administrator", async () => {
    database.findUnique.mockResolvedValue(ACTIVE_ADMIN);
    auth.verifyPassword.mockResolvedValue(true);
    const response = await login(" ADMIN@EXAMPLE.COM ", "correct password");

    expect(response.status).toBe(200);
    expect(database.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { normalizedUsername: "admin@example.com" },
    }));
    expect(auth.issueUserSession).toHaveBeenCalledWith("initial-admin");
    expect(response.headers.get("set-cookie")).toContain("character_archive_user_session=");
    expect(response.headers.get("set-cookie")).toContain("character_archive_session=");
  });

  it("uses the same normal login flow for a newly created ACTIVE MEMBER", async () => {
    database.findUnique.mockResolvedValue(ACTIVE_MEMBER);
    auth.verifyPassword.mockResolvedValue(true);
    const response = await login(" Friend ", "member password phrase");

    expect(response.status).toBe(200);
    expect(database.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { normalizedUsername: "friend" },
    }));
    expect(auth.issueUserSession).toHaveBeenCalledWith("member-1");
  });

  it("uses the same generic response for unknown, wrong-password, and REVOKED users", async () => {
    const results: Array<{ status: number; body: unknown }> = [];

    database.findUnique.mockResolvedValueOnce(null);
    auth.verifyPassword.mockResolvedValueOnce(false);
    let response = await login("unknown", "password");
    results.push({ status: response.status, body: await response.json() });

    database.findUnique.mockResolvedValueOnce(ACTIVE_ADMIN);
    auth.verifyPassword.mockResolvedValueOnce(false);
    response = await login("admin", "wrong");
    results.push({ status: response.status, body: await response.json() });

    database.findUnique.mockResolvedValueOnce({ ...ACTIVE_ADMIN, accessStatus: "REVOKED" });
    auth.verifyPassword.mockResolvedValueOnce(true);
    response = await login("admin", "correct password");
    results.push({ status: response.status, body: await response.json() });

    expect(results).toEqual(Array.from({ length: 3 }, () => ({
      status: 401,
      body: { error: "Invalid username or password." },
    })));
    expect(auth.issueUserSession).not.toHaveBeenCalled();
    expect(auth.loginRateLimiter.recordFailure).toHaveBeenCalledTimes(3);
  });

  it("keeps the existing rate-limit rejection", async () => {
    auth.loginRateLimiter.check.mockReturnValue({ limited: true, retryAfterSeconds: 30 });
    const response = await login("admin", "password");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(database.findUnique).not.toHaveBeenCalled();
  });
});

function login(username: string, password: string): Promise<Response> {
  return POST(new Request("http://localhost:3000/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  }));
}
