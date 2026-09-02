import { describe, expect, it } from "vitest";
import {
  bridgePreflight,
  companionPreflight,
  configuredArchiveOrigins,
  configuredCompanionOrigins,
  requireAllowedArchiveOrigin,
  requireArchiveReceiverOrigin,
  requireCompanionOrigin,
  requireJanitorPageOrigin,
  withBridgeCors,
} from "./config";

describe("bridge origin and CORS policy", () => {
  it("parses only exact HTTP(S) Archive origins", () => {
    expect([...configuredArchiveOrigins("http://localhost:3000, https://archive.example,https://bad.example/path,ftp://no.example")])
      .toEqual(["http://localhost:3000", "https://archive.example"]);
  });

  it("fails closed when the Archive destination is not configured", () => {
    expect(() => requireAllowedArchiveOrigin("https://archive.example", new Set()))
      .toThrowError(expect.objectContaining({ code: "ARCHIVE_ORIGIN_NOT_ALLOWED" }));
  });

  it("parses and requires only exact configured Chrome extension origins", () => {
    const extension = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    expect([...configuredCompanionOrigins(`${extension},chrome-extension://short,https://archive.example`)]).toEqual([extension]);
    expect(requireCompanionOrigin(new Request("https://archive.example/api/bridge/extension/import", {
      headers: { Origin: extension },
    }), new Set([extension]))).toBe(extension);
    expect(() => requireCompanionOrigin(new Request("https://archive.example/api/bridge/extension/import", {
      headers: { Origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba" },
    }), new Set([extension]))).toThrowError(expect.objectContaining({ code: "COMPANION_ORIGIN_NOT_ALLOWED" }));
  });

  it("accepts only the two Janitor page origins", () => {
    expect(requireJanitorPageOrigin(new Request("https://archive.example/api/bridge/import", {
      headers: { Origin: "https://janitorai.com" },
    }))).toBe("https://janitorai.com");
    expect(() => requireJanitorPageOrigin(new Request("https://archive.example/api/bridge/import", {
      headers: { Origin: "https://attacker.example" },
    }))).toThrowError(expect.objectContaining({ code: "SOURCE_ORIGIN_NOT_ALLOWED" }));
  });

  it("accepts only exact same-origin receiver requests from configured Archives", () => {
    const allowed = new Set(["https://archive.example"]);
    expect(requireArchiveReceiverOrigin(new Request("https://archive.example/api/bridge/import", {
      headers: { Origin: "https://archive.example" },
    }), allowed)).toBe("https://archive.example");
    expect(() => requireArchiveReceiverOrigin(new Request("https://archive.example/api/bridge/import", {
      headers: { Origin: "https://janitorai.com" },
    }), allowed)).toThrowError(expect.objectContaining({ code: "RECEIVER_ORIGIN_NOT_ALLOWED" }));
    expect(() => requireArchiveReceiverOrigin(new Request("https://unconfigured.example/api/bridge/import", {
      headers: { Origin: "https://unconfigured.example" },
    }), allowed)).toThrowError(expect.objectContaining({ code: "ARCHIVE_ORIGIN_NOT_ALLOWED" }));
  });

  it("uses exact credential-free CORS without a wildcard or credentials", () => {
    const request = new Request("https://archive.example/api/bridge/import", {
      headers: { Origin: "https://www.janitorai.com" },
    });
    const response = withBridgeCors(request, Response.json({ ok: true }));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://www.janitorai.com");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("returns a preflight denial without reflecting an unapproved origin", () => {
    const response = bridgePreflight(new Request("https://archive.example/api/bridge/import", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.example" },
    }));
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("reflects only an explicitly configured companion origin", () => {
    const extension = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const previous = process.env.BRIDGE_EXTENSION_ORIGINS;
    process.env.BRIDGE_EXTENSION_ORIGINS = extension;
    try {
      const allowed = companionPreflight(new Request("https://archive.example/api/bridge/extension/import", {
        method: "OPTIONS",
        headers: { Origin: extension },
      }));
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(extension);
      expect(allowed.headers.get("Access-Control-Allow-Credentials")).toBeNull();

      const rejected = companionPreflight(new Request("https://archive.example/api/bridge/extension/import", {
        method: "OPTIONS",
        headers: { Origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba" },
      }));
      expect(rejected.status).toBe(403);
      expect(rejected.headers.get("Access-Control-Allow-Origin")).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.BRIDGE_EXTENSION_ORIGINS;
      else process.env.BRIDGE_EXTENSION_ORIGINS = previous;
    }
  });
});
