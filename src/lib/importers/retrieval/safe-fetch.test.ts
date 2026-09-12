import { describe, expect, it, vi } from "vitest";
import { safeFetchText } from "./safe-fetch";

const allowedHosts = ["source.example"];
const json = (body: string, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Response(body, { status: 200, headers });

describe("safe source fetch", () => {
  it("rejects private, loopback, metadata, and mapped private destinations before fetch", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::ffff:192.168.1.4"]) {
      const fetchMock = vi.fn();
      await expect(safeFetchText("https://source.example/character", {
        allowedHosts,
        expectedMimeTypes: ["application/json"],
        fetch: fetchMock,
        lookup: async () => [address],
      })).rejects.toMatchObject({ code: "PRIVATE_DESTINATION" });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it("validates a redirect destination without following it in manual mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/metadata" },
    }));
    await expect(safeFetchText("https://source.example/character", {
      allowedHosts,
      expectedMimeTypes: ["application/json"],
      fetch: fetchMock,
      lookup: async () => ["93.184.216.34"],
      followRedirects: false,
    })).rejects.toMatchObject({ code: "HOST_NOT_ALLOWED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bounds followed redirects and validates MIME and response size", async () => {
    const redirect = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://source.example/next" },
    }));
    await expect(safeFetchText("https://source.example/character", {
      allowedHosts,
      expectedMimeTypes: ["application/json"],
      fetch: redirect,
      lookup: async () => ["93.184.216.34"],
      maxRedirects: 2,
    })).rejects.toMatchObject({ code: "REDIRECT_LIMIT" });

    await expect(safeFetchText("https://source.example/character", {
      allowedHosts,
      expectedMimeTypes: ["application/json"],
      fetch: vi.fn().mockResolvedValue(new Response("<html />", { status: 200, headers: { "content-type": "text/html" } })),
      lookup: async () => ["93.184.216.34"],
    })).rejects.toMatchObject({ code: "UNEXPECTED_MIME" });

    await expect(safeFetchText("https://source.example/character", {
      allowedHosts,
      expectedMimeTypes: ["application/json"],
      fetch: vi.fn().mockResolvedValue(new Response("12345", { status: 200, headers: { "content-type": "application/json" } })),
      lookup: async () => ["93.184.216.34"],
      maxBytes: 4,
    })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });

  it("accepts an ordinary JSON response", async () => {
    const result = await safeFetchText("https://source.example/character", {
      allowedHosts,
      expectedMimeTypes: ["application/json"],
      fetch: vi.fn().mockResolvedValue(json('{"id":"ok"}')),
      lookup: async () => ["93.184.216.34"],
    });
    expect(result.body).toBe('{"id":"ok"}');
  });
});
