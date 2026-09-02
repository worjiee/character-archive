import { describe, expect, it } from "vitest";
import { APPLICATION_SECURITY_HEADERS } from "./security-headers";

describe("application security headers", () => {
  it("sets conservative clickjacking, MIME, referrer, and browser capability policies", () => {
    expect(Object.fromEntries(APPLICATION_SECURITY_HEADERS.map(({ key, value }) => [key, value]))).toEqual({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    });
  });
});
