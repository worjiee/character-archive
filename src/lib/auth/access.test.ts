import { describe, expect, it } from "vitest";
import { decideRouteAccess } from "./access";
import { safePostLoginRedirect } from "./redirects";
import { signOwnerSessionToken } from "./session-token";

const secret = "test-session-secret-that-is-longer-than-thirty-two-bytes";
const now = new Date("2026-08-17T00:00:00.000Z");

async function validToken(): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return signOwnerSessionToken({
    sessionId: "98b56990-dbe6-4fb4-b6da-ed014c00f62c",
    subject: "owner",
    issuedAt,
    expiresAt: issuedAt + 3600,
  }, secret);
}

describe("private route access", () => {
  it("redirects unauthenticated dashboard access to login", async () => {
    await expect(decideRouteAccess("/characters", undefined, secret, now)).resolves.toEqual({
      action: "redirect",
      location: "/login?next=%2Fcharacters",
    });
  });

  it("allows authenticated dashboard access", async () => {
    await expect(decideRouteAccess("/characters/character-id", await validToken(), secret, now)).resolves.toEqual({ action: "allow" });
  });

  it("returns unauthorized for private APIs without a session", async () => {
    await expect(decideRouteAccess("/api/settings", undefined, secret, now)).resolves.toEqual({ action: "unauthorized" });
  });

  it("keeps login and authentication routes public", async () => {
    await expect(decideRouteAccess("/login", undefined, secret, now)).resolves.toEqual({ action: "allow" });
    await expect(decideRouteAccess("/api/auth/login", undefined, secret, now)).resolves.toEqual({ action: "allow" });
  });
});

describe("post-login redirects", () => {
  it("allows private local destinations", () => {
    expect(safePostLoginRedirect("/characters/abc?tab=lorebooks")).toBe("/characters/abc?tab=lorebooks");
  });

  it("rejects external, protocol-relative, API, and login destinations", () => {
    expect(safePostLoginRedirect("https://attacker.example")).toBe("/characters");
    expect(safePostLoginRedirect("//attacker.example")).toBe("/characters");
    expect(safePostLoginRedirect("/api/settings")).toBe("/characters");
    expect(safePostLoginRedirect("/login")).toBe("/characters");
  });
});
