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
    await expect(reconcilePreviewArtworkInventory(manifest, runtime())).resolves.toEqual({
      expected: 83,
      present: 2,
      missing: 82,
      unexpected: 1,
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
    operatorSecretHash: "unused-in-this-test",
    expiresAt: new Date("2026-09-03T01:00:00.000Z"),
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
