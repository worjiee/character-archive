import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { config, proxy } from "./proxy";
import { USER_SESSION_COOKIE } from "./src/lib/auth";

describe("Next.js Proxy whole-site gate", () => {
  it("matches every page and API family while excluding static assets", () => {
    for (const url of ["/", "/authors", "/lorebooks/one", "/favorites", "/api/settings", "/api/future-route"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    }
    for (const url of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.png"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
    }
  });

  it("redirects private pages and returns 401 for private APIs without the new cookie", () => {
    const pageResponse = proxy(new NextRequest("http://localhost:3000/authors"));
    expect(pageResponse.status).toBe(307);
    expect(pageResponse.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fauthors");

    const apiResponse = proxy(new NextRequest("http://localhost:3000/api/settings"));
    expect(apiResponse.status).toBe(401);
  });

  it("returns the importer session error contract at the proxy boundary", async () => {
    const response = proxy(new NextRequest("http://localhost:3000/api/import/preview", { method: "POST" }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTHENTICATION_REQUIRED", message: "Your session has expired. Sign in again and retry." },
    });
  });

  it("passes a new opaque cookie only to the authoritative database layer", () => {
    const request = new NextRequest("http://localhost:3000/characters", {
      headers: { cookie: `${USER_SESSION_COOKIE}=${"A".repeat(43)}` },
    });
    expect(proxy(request).status).toBe(200);
  });
});
