import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  APPROVED_271_ARTWORK,
  APPROVED_271_BY_DIGEST,
  BASELINE_83_DIGESTS,
  BASELINE_83_SET,
} from "./large-catalog-manifest";
import {
  assertOperatorAuthorized,
  assertPreviewEnvironment,
  issueUploadCapability,
  issueVerificationProof,
  LargeCatalogTransferError,
  verifyBoundedBytesBatch,
  verifyVerificationProof,
} from "./large-catalog-transfer";

describe("large-catalog artwork manifest & transfer guardrails", () => {
  it("contains exactly 271 approved artwork entries and 83 baseline digests with 0 overlap", () => {
    expect(APPROVED_271_ARTWORK.length).toBe(271);
    expect(APPROVED_271_BY_DIGEST.size).toBe(271);
    expect(BASELINE_83_DIGESTS.length).toBe(83);
    expect(BASELINE_83_SET.size).toBe(83);

    for (const digest of BASELINE_83_SET) {
      expect(APPROVED_271_BY_DIGEST.has(digest)).toBe(false);
    }

    for (const [digest, entry] of APPROVED_271_BY_DIGEST) {
      expect(BASELINE_83_SET.has(digest)).toBe(false);
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.byteLength).toBeGreaterThan(0);
    }
  });

  it("strictly enforces baseline immutability by rejecting any baseline digest with 409", async () => {
    const sampleBaselineDigest = BASELINE_83_DIGESTS[0];
    await expect(
      issueUploadCapability(sampleBaselineDigest, { token: "dummy" }),
    ).rejects.toThrowError(LargeCatalogTransferError);

    try {
      await issueUploadCapability(sampleBaselineDigest, { token: "dummy" });
    } catch (err) {
      expect(err).toBeInstanceOf(LargeCatalogTransferError);
      expect((err as LargeCatalogTransferError).code).toBe("BASELINE_ASSET_IMMUTABLE");
      expect((err as LargeCatalogTransferError).status).toBe(409);
    }
  });

  it("strictly rejects unapproved digests with 403", async () => {
    const unapprovedDigest = "0000000000000000000000000000000000000000000000000000000000000000";
    try {
      await issueUploadCapability(unapprovedDigest, { token: "dummy" });
    } catch (err) {
      expect(err).toBeInstanceOf(LargeCatalogTransferError);
      expect((err as LargeCatalogTransferError).code).toBe("UNAPPROVED_DIGEST");
      expect((err as LargeCatalogTransferError).status).toBe(403);
    }
  });

  it("strictly enforces Preview-only environment", () => {
    expect(() => assertPreviewEnvironment({ VERCEL_ENV: "production" })).toThrowError(
      LargeCatalogTransferError,
    );
    expect(() => assertPreviewEnvironment({ VERCEL_ENV: "preview" })).not.toThrow();
    expect(() => assertPreviewEnvironment({ PREVIEW_LARGE_CATALOG_ALLOWED: "true" })).not.toThrow();
  });

  it("validates operator authorization with constant-time equality", () => {
    const secret = "test-secret-12345";
    const secretHash = createHash("sha256").update(secret, "utf8").digest("hex");

    expect(() => assertOperatorAuthorized(secret, secretHash)).not.toThrow();
    expect(() => assertOperatorAuthorized("wrong-secret", secretHash)).toThrowError(
      LargeCatalogTransferError,
    );
    expect(() => assertOperatorAuthorized(null, secretHash)).toThrowError(
      LargeCatalogTransferError,
    );
  });

  it("bounds batch byte-verification to at most 30 items per call", async () => {
    const tooMany = Array.from({ length: 31 }, () => "dummy");
    await expect(
      verifyBoundedBytesBatch(tooMany, { token: "dummy" }),
    ).rejects.toThrowError("Batch byte-verification is bounded to at most 30 objects per call.");
  });

  it("issues and cryptographically verifies proof tokens", () => {
    const secretHash = createHash("sha256").update("test-operator-secret", "utf8").digest("hex");
    const mockInventory = {
      expected: 354,
      baselineExpected: 83,
      baselinePresent: 83,
      newExpected: 271,
      newPresent: 10,
      newMissing: 261,
      unexpected: 0,
      presentDigests: ["abc"],
      missingDigests: ["def"],
    };

    const token = issueVerificationProof(["abc"], mockInventory, secretHash);
    expect(typeof token).toBe("string");
    expect(token).toContain(".");

    const verified = verifyVerificationProof(token, secretHash);
    expect(verified.expectedCount).toBe(354);
    expect(verified.verifiedDigests).toEqual(["abc"]);

    // Fails with wrong secret
    const wrongHash = createHash("sha256").update("wrong", "utf8").digest("hex");
    expect(() => verifyVerificationProof(token, wrongHash)).toThrowError("Verification proof signature is invalid.");
  });
});
