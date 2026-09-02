import { describe, expect, it } from "vitest";
import { decideRouteAccess } from "./access";
import { safePostLoginRedirect } from "./redirects";
import { LEGACY_OWNER_SESSION_COOKIE } from "./session-token";

const validToken = "A".repeat(43);

describe("whole-site optimistic access", () => {
  it("redirects every private page family without the new cookie", () => {
    for (const path of ["/", "/characters", "/authors", "/lorebooks", "/favorites", "/cart", "/import", "/blocked", "/settings", "/future-page"]) {
      expect(decideRouteAccess(path, undefined).action).toBe("redirect");
    }
  });

  it("allows syntactically valid new-session cookies through to authoritative checks", () => {
    expect(decideRouteAccess("/characters/character-id", validToken)).toEqual({ action: "allow" });
  });

  it("rejects legacy owner cookie values", () => {
    expect(LEGACY_OWNER_SESSION_COOKIE).toBe("character_archive_session");
    expect(decideRouteAccess("/characters", "legacy.payload.signature")).toEqual({
      action: "redirect",
      location: "/login?next=%2Fcharacters",
    });
  });

  it("returns 401 decisions for private APIs without a new session", () => {
    expect(decideRouteAccess("/api/settings", undefined)).toEqual({ action: "unauthorized" });
    expect(decideRouteAccess("/api/future-route", undefined)).toEqual({ action: "unauthorized" });
  });

  it("keeps only login, health, and capability-authenticated bridge transport public", () => {
    for (const path of [
      "/login",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/health",
      "/bridge/receiver",
      "/api/bridge/pair/exchange",
      "/api/bridge/import",
      "/api/bridge/extension/pair/exchange",
      "/api/bridge/extension/import",
    ]) {
      expect(decideRouteAccess(path, undefined)).toEqual({ action: "allow" });
    }
    for (const path of ["/api/bridge/pair", "/api/bridge/jobs/job-1", "/api/import/save"]) {
      expect(decideRouteAccess(path, undefined)).toEqual({ action: "unauthorized" });
    }
  });
});

describe("post-login redirects", () => {
  it("allows private local destinations across the site", () => {
    expect(safePostLoginRedirect("/authors?sort=recent")).toBe("/authors?sort=recent");
    expect(safePostLoginRedirect("/characters/abc?tab=lorebooks")).toBe("/characters/abc?tab=lorebooks");
  });

  it("rejects external, protocol-relative, API, login, and bridge receiver destinations", () => {
    expect(safePostLoginRedirect("https://attacker.example")).toBe("/characters");
    expect(safePostLoginRedirect("//attacker.example")).toBe("/characters");
    expect(safePostLoginRedirect("/api/settings")).toBe("/characters");
    expect(safePostLoginRedirect("/login")).toBe("/characters");
    expect(safePostLoginRedirect("/bridge/receiver")).toBe("/characters");
  });
});
