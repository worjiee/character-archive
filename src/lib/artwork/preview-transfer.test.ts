import { createHash } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client";
import { generatePasswordHash } from "../auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const blob = vi.hoisted(() => ({
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => blob);

import {
  issuePreviewArtworkUploadCapability,
  loadApprovedPreviewArtwork,
  loadPreviewArtworkManifest,
  PREVIEW_ARTWORK_ASSET_COUNT,
  PreviewArtworkTransferError,
  readPreviewArtworkTransferRuntime,
  reconcilePreviewArtworkInventory,
  resolvePreviewArtworkOidcToken,
  verifyPreviewArtworkObject,
  verifyPreviewArtworkOperatorSecret,
  deriveProofSigningKey,
  issueVerificationProof,
  verifyVerificationProof,
  verifyVerificationProofForAdvancement,
  type PreviewArtworkManifestItem,
  type PreviewArtworkTransferRuntime,
} from "./preview-transfer";

describe("temporary Preview artwork transfer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    blob.issueSignedToken.mockResolvedValue({ delegationToken: "delegation", clientSigningToken: "signing", validUntil: Date.now() + 300_000 });
    blob.presignUrl.mockResolvedValue({ presignedUrl: "https://blob.vercel-storage.com/upload" });
    blob.list.mockResolvedValue({ blobs: [], hasMore: false });
  });

  it("fails closed outside the exact enabled Preview deployment identity", async () => {
    const secretHash = await generatePasswordHash("one-time operator phrase");
    const base = environment(secretHash);
    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_ENV: "production" }, NOW)).toThrow(PreviewArtworkTransferError);
    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_PROJECT_ID: "wrong-project" }, NOW)).toThrow(PreviewArtworkTransferError);
    expect(() => readPreviewArtworkTransferRuntime({ ...base, BLOB_STORE_ID: "wrong-store" }, NOW)).toThrow(PreviewArtworkTransferError);
    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_GIT_COMMIT_REF: "main" }, NOW)).toThrow(PreviewArtworkTransferError);
    expect(() => readPreviewArtworkTransferRuntime({ ...base, PREVIEW_ARTWORK_TRANSFER_ENABLED: "false" }, NOW)).toThrow(PreviewArtworkTransferError);
  });

  it("resolves deployment-native OIDC from request header and rejects spoofed sources", async () => {
    const secretHash = await generatePasswordHash("one-time operator phrase");
    const baseWithoutEnvOidc = { ...environment(secretHash), VERCEL_OIDC_TOKEN: undefined };

    // Valid platform request header is accepted
    const validRequest = new Request("https://preview.vercel.app/api/admin/preview-artwork-transfer", {
      headers: { "x-vercel-oidc-token": "platform-injected-oidc-token" },
    });
    const runtime = readPreviewArtworkTransferRuntime(validRequest, baseWithoutEnvOidc, NOW);
    expect(runtime.credentials.oidcToken).toBe("platform-injected-oidc-token");

    // Client/body/header spoofing cannot substitute arbitrary operator-provided tokens
    const spoofedRequest = new Request("https://preview.vercel.app/api/admin/preview-artwork-transfer", {
      headers: {
        "x-preview-oidc-token": "spoofed-token",
        "authorization": "Bearer spoofed-token",
      },
    });
    expect(resolvePreviewArtworkOidcToken(spoofedRequest, baseWithoutEnvOidc)).toBeUndefined();
    expect(() => readPreviewArtworkTransferRuntime(spoofedRequest, baseWithoutEnvOidc, NOW)).toThrow(
      "Preview artwork transfer is unavailable: OIDC token unavailable.",
    );

    // [SENSITIVE] mask is rejected
    const sensitiveHeaderRequest = new Request("https://preview.vercel.app/api/admin/preview-artwork-transfer", {
      headers: { "x-vercel-oidc-token": "[SENSITIVE]" },
    });
    expect(resolvePreviewArtworkOidcToken(sensitiveHeaderRequest, baseWithoutEnvOidc)).toBeUndefined();
  });

  it("classifies diagnostic failure reasons safely without exposing secrets", async () => {
    const secretHash = await generatePasswordHash("one-time operator phrase");
    const base = environment(secretHash);

    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_ENV: "production" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: environment is not preview.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_GIT_COMMIT_REF: "main" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: git commit ref is not develop.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, ARTWORK_STORAGE_PROVIDER: "local" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: artwork storage provider is not vercel-blob.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, PREVIEW_ARTWORK_TRANSFER_ENABLED: "false" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: transfer is not enabled.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_PROJECT_ID: "mismatch" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: project ID mismatch.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, BLOB_STORE_ID: "mismatch" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: store ID mismatch.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, VERCEL_OIDC_TOKEN: undefined }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: OIDC token unavailable.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, PREVIEW_ARTWORK_TRANSFER_EXPIRES_AT: "2020-01-01T00:00:00Z" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: transfer window expired or invalid.",
    );
    expect(() => readPreviewArtworkTransferRuntime({ ...base, PREVIEW_ARTWORK_TRANSFER_SECRET_HASH: "invalid" }, NOW)).toThrow(
      "Preview artwork transfer is unavailable: operator secret hash syntax invalid.",
    );
  });

  it("requires the separately hashed operator secret", async () => {
    const secretHash = await generatePasswordHash("one-time operator phrase");
    const runtime = readPreviewArtworkTransferRuntime(environment(secretHash), NOW);
    await expect(verifyPreviewArtworkOperatorSecret("one-time operator phrase", runtime)).resolves.toBe(true);
    await expect(verifyPreviewArtworkOperatorSecret("wrong operator phrase", runtime)).resolves.toBe(false);
  });

  it("accepts only the exact approved 83-row Preview manifest and current admin session", async () => {
    const manifest = await loadPreviewArtworkManifest(database(), { sessionId: "session-1", userId: "initial-admin" });
    expect(manifest).toHaveLength(PREVIEW_ARTWORK_ASSET_COUNT);
    expect(manifest.every((item) => item.storageKey === `artwork/sha256/${item.sha256}.png`)).toBe(true);
  });

  it("rejects a digest that is absent from approved ArtworkAsset relationships", async () => {
    const client = database();
    await expect(loadApprovedPreviewArtwork(client, "f".repeat(64))).rejects.toMatchObject({ code: "INVALID_TRANSFER_REQUEST" });
    await expect(loadApprovedPreviewArtwork(client, "../../secret")).rejects.toMatchObject({ code: "INVALID_TRANSFER_REQUEST" });
  });

  it("issues a five-minute write-only capability for the server-selected exact path", async () => {
    const item = items()[0];
    await issuePreviewArtworkUploadCapability(item, runtime(), NOW);
    expect(blob.issueSignedToken).toHaveBeenCalledWith(expect.objectContaining({
      pathname: item.storageKey,
      operations: ["put"],
      maximumSizeInBytes: item.byteLength,
      allowedContentTypes: ["image/png"],
    }));
    expect(blob.presignUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      access: "private",
      operation: "put",
      pathname: item.storageKey,
      allowOverwrite: false,
      addRandomSuffix: false,
    }));
  });

  it("refuses a capability when the supplied metadata path does not match its digest", async () => {
    const item = { ...items()[0], storageKey: `artwork/sha256/${"f".repeat(64)}.png` };
    await expect(issuePreviewArtworkUploadCapability(item, runtime(), NOW)).rejects.toMatchObject({
      code: "INVALID_TRANSFER_REQUEST",
    });
    expect(blob.issueSignedToken).not.toHaveBeenCalled();
  });

  it("re-reads bytes and verifies digest, length, and media type", async () => {
    const bytes = new TextEncoder().encode("approved png-shaped test bytes");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const item: PreviewArtworkManifestItem = {
      sha256,
      mediaType: "image/png",
      byteLength: bytes.byteLength,
      width: 1,
      height: 1,
      storageKey: `artwork/sha256/${sha256}.png`,
    };
    blob.get.mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
      blob: { pathname: item.storageKey, size: bytes.byteLength, contentType: "image/png" },
    });
    await expect(verifyPreviewArtworkObject(item, runtime())).resolves.toBeUndefined();
    blob.get.mockResolvedValueOnce({
      statusCode: 200,
      stream: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes.byteLength)); controller.close(); } }),
      blob: { pathname: item.storageKey, size: bytes.byteLength, contentType: "image/png" },
    });
    await expect(verifyPreviewArtworkObject(item, runtime())).rejects.toMatchObject({ code: "ARTWORK_VERIFICATION_FAILED" });
  });

  it("reports missing and unexpected managed-prefix inventory", async () => {
    const manifest = items();
    blob.list.mockResolvedValue({
      blobs: [
        { pathname: manifest[0].storageKey, size: manifest[0].byteLength },
        { pathname: `artwork/sha256/${"f".repeat(64)}.png`, size: 12 },
      ],
      hasMore: false,
    });
    await expect(reconcilePreviewArtworkInventory(manifest, runtime())).resolves.toMatchObject({
      expected: 83,
      present: 1,
      missing: 82,
      unexpected: 1,
      presentDigests: [manifest[0].sha256],
    });
  });

  describe("cryptographic verification proof", () => {
    const rt = runtime();
    const manifest = items();
    const presentDigests = manifest.slice(0, 10).map((i) => i.sha256);
    const mockInventory = {
      expected: 83,
      present: 10,
      missing: 73,
      unexpected: 0,
      presentDigests,
      missingDigests: manifest.slice(10).map((i) => i.sha256),
    };

    it("derives domain-separated keys safely without using password hash directly", () => {
      const key1 = deriveProofSigningKey(rt.operatorSecretHash, "store-1", "project-1");
      const key2 = deriveProofSigningKey(rt.operatorSecretHash, "store-2", "project-1");
      const key3 = deriveProofSigningKey(rt.operatorSecretHash, "store-1", "project-2");

      expect(key1).toHaveLength(32);
      expect(key1).not.toEqual(Buffer.from(rt.operatorSecretHash));
      expect(key1).not.toEqual(key2);
      expect(key1).not.toEqual(key3);
    });

    it("issues and verifies a valid proof with sorted canonical digests", () => {
      const unsorted = [presentDigests[2], presentDigests[0], presentDigests[1]];
      const token = issueVerificationProof(unsorted, mockInventory, rt);
      const verified = verifyVerificationProof(token, mockInventory, rt);

      expect(verified.projectId).toBe("project-1");
      expect(verified.storeId).toBe("store-1");
      expect(verified.presentCount).toBe(10);
      expect(verified.verifiedDigests).toEqual([presentDigests[0], presentDigests[1], presentDigests[2]].sort());
    });

    it("rejects a tampered proof signature", () => {
      const token = issueVerificationProof(presentDigests.slice(0, 3), mockInventory, rt);
      const [payloadB64, signature] = token.split(".");
      const tamperedSig = signature.slice(0, -2) + "ab";
      expect(() => verifyVerificationProof(`${payloadB64}.${tamperedSig}`, mockInventory, rt)).toThrow(
        "Verification proof signature is invalid.",
      );
    });

    it("rejects a tampered payload content", () => {
      const token = issueVerificationProof(presentDigests.slice(0, 3), mockInventory, rt);
      const [, signature] = token.split(".");
      const alteredPayload = Buffer.from(JSON.stringify({
        projectId: "project-1",
        storeId: "store-1",
        expectedCount: 83,
        presentCount: 10,
        missingCount: 73,
        unexpectedCount: 0,
        verifiedDigests: presentDigests, // expanded without re-signing!
        issuedAt: Date.now(),
        expiresAt: Date.now() + 60000,
      })).toString("base64url");

      expect(() => verifyVerificationProof(`${alteredPayload}.${signature}`, mockInventory, rt)).toThrow(
        "Verification proof signature is invalid.",
      );
    });

    it("rejects an expired proof", () => {
      const pastTime = new Date("2026-09-02T00:00:00.000Z");
      const token = issueVerificationProof(presentDigests.slice(0, 3), mockInventory, rt, pastTime);
      const now = new Date("2026-09-03T00:00:00.000Z");

      expect(() => verifyVerificationProof(token, mockInventory, rt, now)).toThrow(
        "Verification proof has expired.",
      );
    });

    it("rejects proof with wrong project or store context", () => {
      const wrongRt: PreviewArtworkTransferRuntime = {
        ...rt,
        expectedProjectId: "different-project",
      };
      const token = issueVerificationProof(presentDigests.slice(0, 3), mockInventory, rt);

      expect(() => verifyVerificationProof(token, mockInventory, wrongRt)).toThrow(
        "Verification proof signature is invalid.",
      );
    });

    it("rejects proof if live inventory mutated between batches", () => {
      const token = issueVerificationProof(presentDigests.slice(0, 3), mockInventory, rt);
      const mutatedInventory = {
        ...mockInventory,
        present: 11, // newly added object or mismatch
        presentDigests: [...presentDigests, "a".repeat(64)],
      };

      expect(() => verifyVerificationProof(token, mutatedInventory, rt)).toThrow(
        "Verification proof inventory state does not match live storage.",
      );
    });

    it("rejects proof if live storage has unexpected objects", () => {
      const token = issueVerificationProof(presentDigests.slice(0, 3), mockInventory, rt);
      const mutatedInventory = {
        ...mockInventory,
        unexpected: 1,
      };

      expect(() => verifyVerificationProof(token, mutatedInventory, rt)).toThrow(
        "Verification proof inventory state does not match live storage.",
      );
    });

    it("rejects proof containing a digest not in present inventory", () => {
      const alienDigest = "f".repeat(64);
      const inventoryWithAlien = {
        ...mockInventory,
        presentDigests: [...mockInventory.presentDigests, alienDigest],
        present: mockInventory.present + 1,
      };
      const token = issueVerificationProof([alienDigest], inventoryWithAlien, rt);

      // Now verify against original inventory where alienDigest is absent
      expect(() => verifyVerificationProof(token, mockInventory, rt)).toThrow(
        "Verification proof inventory state does not match live storage.",
      );
    });

    describe("single-object proof advancement", () => {
      const nextDigest = manifest[10].sha256;
      const initialProof = issueVerificationProof(presentDigests, mockInventory, rt);
      const advancedInventory = {
        expected: 83,
        present: 11,
        missing: 72,
        unexpected: 0,
        presentDigests: [...presentDigests, nextDigest],
        missingDigests: manifest.slice(11).map((i) => i.sha256),
      };

      it("advances proof successfully on valid monotonic N -> N+1 inventory transition", () => {
        const payload = verifyVerificationProofForAdvancement(initialProof, nextDigest, advancedInventory, rt);
        expect(payload.presentCount).toBe(10);
        expect(payload.verifiedDigests).toEqual(presentDigests.slice().sort());

        // Minting new proof token with the advanced inventory
        const newVerified = [...payload.verifiedDigests, nextDigest].sort();
        const nextToken = issueVerificationProof(newVerified, advancedInventory, rt);
        const nextPayload = verifyVerificationProof(nextToken, advancedInventory, rt);
        expect(nextPayload.presentCount).toBe(11);
        expect(nextPayload.verifiedDigests).toEqual(newVerified);
      });

      it("rejects advancement if newly uploaded digest is already verified in proof", () => {
        expect(() =>
          verifyVerificationProofForAdvancement(initialProof, presentDigests[0], advancedInventory, rt),
        ).toThrow("Newly uploaded digest is already verified in proof.");
      });

      it("rejects advancement if newly uploaded digest is not in storage", () => {
        const absentDigest = "e".repeat(64);
        expect(() =>
          verifyVerificationProofForAdvancement(initialProof, absentDigest, advancedInventory, rt),
        ).toThrow("Newly uploaded digest is not present in storage.");
      });

      it("rejects advancement if >1 object mutated into storage", () => {
        const mutatedPlus2 = {
          ...advancedInventory,
          present: 12,
          missing: 71,
          presentDigests: [...advancedInventory.presentDigests, manifest[11].sha256],
        };
        expect(() =>
          verifyVerificationProofForAdvancement(initialProof, nextDigest, mutatedPlus2, rt),
        ).toThrow("Inventory transition is invalid or storage state mutated unexpectedly.");
      });

      it("rejects advancement if unexpected objects exist in storage", () => {
        const withUnexpected = {
          ...advancedInventory,
          unexpected: 1,
        };
        expect(() =>
          verifyVerificationProofForAdvancement(initialProof, nextDigest, withUnexpected, rt),
        ).toThrow("Inventory transition is invalid or storage state mutated unexpectedly.");
      });

      it("rejects advancement if an existing verified digest went missing", () => {
        const droppedDigestInventory = {
          ...advancedInventory,
          presentDigests: [...presentDigests.slice(1), nextDigest], // dropped presentDigests[0]
        };
        expect(() =>
          verifyVerificationProofForAdvancement(initialProof, nextDigest, droppedDigestInventory, rt),
        ).toThrow("Proof contains unverified or unapproved digest.");
      });

      it("rejects tampered advancement proof token", () => {
        const [payloadB64, signature] = initialProof.split(".");
        const tampered = `${payloadB64}.${signature.slice(0, -2)}xx`;
        expect(() =>
          verifyVerificationProofForAdvancement(tampered, nextDigest, advancedInventory, rt),
        ).toThrow("Verification proof signature is invalid.");
      });

      it("rejects expired advancement proof token", () => {
        const past = new Date("2026-09-02T00:00:00.000Z");
        const expiredProof = issueVerificationProof(presentDigests, mockInventory, rt, past);
        const now = new Date("2026-09-03T00:00:00.000Z");
        expect(() =>
          verifyVerificationProofForAdvancement(expiredProof, nextDigest, advancedInventory, rt, now),
        ).toThrow("Verification proof has expired.");
      });
    });
  });
});

const NOW = new Date("2026-09-03T00:00:00.000Z");

function environment(secretHash: string): Record<string, string | undefined> {
  return {
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "develop",
    VERCEL_PROJECT_ID: "project-1",
    BLOB_STORE_ID: "store-1",
    VERCEL_OIDC_TOKEN: "oidc-token",
    ARTWORK_STORAGE_PROVIDER: "vercel-blob",
    PREVIEW_ARTWORK_TRANSFER_ENABLED: "true",
    PREVIEW_ARTWORK_TRANSFER_EXPECTED_PROJECT_ID: "project-1",
    PREVIEW_ARTWORK_TRANSFER_EXPECTED_STORE_ID: "store-1",
    PREVIEW_ARTWORK_TRANSFER_SECRET_HASH: secretHash,
    PREVIEW_ARTWORK_TRANSFER_EXPIRES_AT: "2026-09-03T01:00:00.000Z",
  };
}

function runtime(): PreviewArtworkTransferRuntime {
  return {
    credentials: { oidcToken: "oidc-token", storeId: "store-1" },
    operatorSecretHash: "$scrypt$N=16384,r=8,p=1$7uU2xQ$dGVzdC1oYXNo",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    expectedProjectId: "project-1",
    expectedStoreId: "store-1",
  };
}

function items(): PreviewArtworkManifestItem[] {
  return Array.from({ length: PREVIEW_ARTWORK_ASSET_COUNT }, (_, index) => {
    const sha256 = index.toString(16).padStart(64, "0");
    return {
      sha256,
      mediaType: "image/png" as const,
      byteLength: 100 + index,
      width: 10,
      height: 20,
      storageKey: `artwork/sha256/${sha256}.png`,
    };
  });
}

function database(): PrismaClient {
  const assets = items().map((item) => ({ ...item, _count: { characters: 1 } }));
  return {
    artworkAsset: {
      findMany: vi.fn(async () => assets),
      findUnique: vi.fn(async ({ where }: { where: { sha256: string } }) => assets.find((item) => item.sha256 === where.sha256) ?? null),
    },
    character: { count: vi.fn(async (args?: unknown) => args ? 83 : 84) },
    characterSource: { count: vi.fn(async () => 84) },
    user: { findMany: vi.fn(async () => [{ id: "initial-admin", username: "preview-admin", role: "ADMIN", accessStatus: "ACTIVE" }]) },
    userSession: { findMany: vi.fn(async () => [{ id: "session-1", userId: "initial-admin" }]) },
    characterFavorite: { count: vi.fn(async () => 0) },
    characterCartItem: { count: vi.fn(async () => 0) },
    importPreviewJob: { count: vi.fn(async () => 0) },
    bridgePairing: { count: vi.fn(async () => 0) },
    bridgeSession: { count: vi.fn(async () => 0) },
    bridgeJob: { count: vi.fn(async () => 0) },
    sourceConnection: { count: vi.fn(async () => 0) },
  } as unknown as PrismaClient;
}
