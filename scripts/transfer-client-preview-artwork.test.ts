import { describe, expect, it } from "vitest";
import { readCapabilityUrl } from "./transfer-client-preview-artwork";

describe("readCapabilityUrl validation", () => {
  const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const expectedKey = `artwork/sha256/${digest}.png`;

  it("accepts valid Vercel Blob control API presigned upload URL", () => {
    const validApiUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}&vercel-blob-delegation=del_test&vercel-blob-signature=sig_test`;
    const result = readCapabilityUrl({ sha256: digest, capabilityUrl: validApiUrl }, digest);
    expect(result).toBe(validApiUrl);
  });

  it("accepts valid api.vercel.com control API presigned upload URL", () => {
    const validApiUrl = `https://api.vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}&token=test`;
    const result = readCapabilityUrl({ sha256: digest, capabilityUrl: validApiUrl }, digest);
    expect(result).toBe(validApiUrl);
  });

  it("accepts valid Vercel Blob CDN upload URL", () => {
    const validCdnUrl = `https://blob.vercel-storage.com/${expectedKey}?token=test`;
    const result = readCapabilityUrl({ sha256: digest, capabilityUrl: validCdnUrl }, digest);
    expect(result).toBe(validCdnUrl);
  });

  it("rejects non-HTTPS protocols", () => {
    const insecureUrl = `http://vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: insecureUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );
  });

  it("rejects arbitrary / untrusted destinations", () => {
    const attackerUrl = `https://attacker.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: attackerUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );
  });

  it("rejects mismatched or path-traversal target paths", () => {
    const wrongPathUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent("artwork/sha256/other.png")}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: wrongPathUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );

    const traversalUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(`artwork/sha256/../../${digest}.png`)}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: traversalUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );
  });

  it("rejects digest mismatch in response payload", () => {
    const validApiUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}`;
    expect(() => readCapabilityUrl({ sha256: "different-digest", capabilityUrl: validApiUrl }, digest)).toThrow(
      "The Preview artwork capability response was invalid.",
    );
  });
});
