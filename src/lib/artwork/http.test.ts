import { describe, expect, it } from "vitest";
import { artworkResponse } from "./http";

describe("artwork HTTP responses", () => {
  it("keeps pending artwork private and uncacheable", () => {
    const response = artworkResponse(Uint8Array.of(1), { etag: "a".repeat(64), pending: true });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it("uses private immutable caching and digest ETags for final artwork", () => {
    const digest = "a".repeat(64);
    const response = artworkResponse(Uint8Array.of(1), { etag: digest });
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toBe(`"${digest}"`);
    const notModified = artworkResponse(Uint8Array.of(1), {
      etag: digest,
      request: new Request("http://localhost/artwork", { headers: { "if-none-match": `"${digest}"` } }),
    });
    expect(notModified.status).toBe(304);
  });
});
