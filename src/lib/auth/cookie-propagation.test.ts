import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import {
  USER_SESSION_COOKIE,
  LEGACY_OWNER_SESSION_COOKIE,
  userSessionCookieOptions,
  readRequestCookie,
  isSameOriginWhenPresent,
} from "./index";
import { decideRouteAccess } from "./access";

describe("session cookie propagation: login -> capture -> control", () => {
  it("reproduces login -> capture session cookie -> authenticated control request without leaking secrets", () => {
    // 1. Simulate server producing login response exactly as app/api/auth/login/route.ts does
    const dummyToken = "abc123def456ghi789jkl012mno345pqr678stu9012";
    const expiresAt = new Date(Date.now() + 86400000);
    const loginResponse = NextResponse.json({ success: true, redirectTo: "/" });
    loginResponse.cookies.set(USER_SESSION_COOKIE, dummyToken, userSessionCookieOptions(expiresAt));
    loginResponse.cookies.set(LEGACY_OWNER_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

    // 2. Client captures cookie using exact logic from transfer script
    const headers = loginResponse.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies = headers.getSetCookie?.() ?? [loginResponse.headers.get("set-cookie") ?? ""];
    const cookie = setCookies
      .map((value) => value.split(";", 1)[0])
      .find((value) => value.startsWith(`${USER_SESSION_COOKIE}=`));

    expect(cookie).toBeDefined();
    expect(cookie).toBe(`${USER_SESSION_COOKIE}=${dummyToken}`);
    // Check that cookie attributes are excluded
    expect(cookie).not.toContain("Path=");
    expect(cookie).not.toContain("HttpOnly");
    expect(cookie).not.toContain("Expires=");
    expect(cookie).not.toContain("SameSite=");

    // 3. Control request sends the captured cookie
    const origin = "https://character-archive-git-develop-karls-projects-fccc69ea.vercel.app";
    const controlRequest = new Request(`${origin}/api/admin/preview-artwork-transfer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie!,
        Origin: origin,
        "x-preview-artwork-transfer-secret": "test-secret",
      },
      body: JSON.stringify({ action: "preflight" }),
    });

    // 4. Server extracts token via readRequestCookie
    const extractedToken = readRequestCookie(controlRequest, USER_SESSION_COOKIE);
    expect(extractedToken).toBe(dummyToken);

    // 5. Origin guard
    expect(isSameOriginWhenPresent(controlRequest)).toBe(true);

    // 6. Middleware decideRouteAccess
    const decision = decideRouteAccess("/api/admin/preview-artwork-transfer", extractedToken);
    expect(decision.action).toBe("allow");
  });
});
