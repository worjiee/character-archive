import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { issueSignedToken, list, presignUrl } from "@vercel/blob";
import type { PrismaClient } from "../../../generated/prisma/client";
import { verifyPassword, validatePasswordHash } from "../auth";
import {
  assertFinalArtworkStorageKey,
  assertMetadataMatchesBytes,
  finalArtworkStorageKey,
  FINAL_ARTWORK_PREFIX,
} from "./local-store";
import type { ArtworkMetadata } from "./types";
import { ARTWORK_SHA256_PATTERN } from "./types";
export { ARTWORK_SHA256_PATTERN } from "./types";
import { VercelBlobArtworkObjectStore, type VercelBlobCredentials } from "./vercel-blob-store";

export const PREVIEW_ARTWORK_ASSET_COUNT = 83;
export const PREVIEW_CHARACTER_COUNT = 84;
export const PREVIEW_CHARACTER_SOURCE_COUNT = 84;
export const PREVIEW_ARTWORK_MAX_BYTES = 32 * 1024 * 1024;
export const PREVIEW_ARTWORK_CAPABILITY_TTL_MS = 5 * 60 * 1_000;
export const PREVIEW_ARTWORK_TRANSFER_MAX_LIFETIME_MS = 24 * 60 * 60 * 1_000;
export const PREVIEW_VERIFICATION_PROOF_MAX_TTL_MS = 15 * 60 * 1_000;
export const PREVIEW_ARTWORK_VERIFY_BATCH_MAX_SIZE = 8;

export interface PreviewArtworkManifestItem extends ArtworkMetadata {
  storageKey: string;
}

export interface PreviewArtworkTransferRuntime {
  credentials: Extract<VercelBlobCredentials, { oidcToken: string }>;
  operatorSecretHash: string;
  expiresAt: Date;
  expectedProjectId: string;
  expectedStoreId: string;
}

export class PreviewArtworkTransferError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PreviewArtworkTransferError";
  }
}

/**
 * Resolves the deployment-native OIDC token for temporary Preview artwork transfer.
 *
 * Trust Boundary & Security Contract:
 * - On Vercel, the edge gateway intercepts external requests and strips or overwrites any
 *   client-supplied `x-vercel-*` headers. The `x-vercel-oidc-token` header received by
 *   the Serverless Function is cryptographically issued and injected by the Vercel platform.
 * - This function never accepts tokens from request bodies (JSON), query parameters, cookies,
 *   or custom client headers (`x-preview-*`).
 * - In local development / automated tests, fallback to `env.VERCEL_OIDC_TOKEN` is permitted
 *   if not masked as `"[SENSITIVE]"`.
 */
export function resolvePreviewArtworkOidcToken(
  request?: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  const headerToken = request?.headers.get("x-vercel-oidc-token")?.trim();
  if (headerToken && headerToken !== "[SENSITIVE]") {
    return headerToken;
  }

  const envToken = env.VERCEL_OIDC_TOKEN?.trim();
  if (envToken && envToken !== "[SENSITIVE]") {
    return envToken;
  }

  return undefined;
}

export function readPreviewArtworkTransferRuntime(
  requestOrEnv?: Request | Readonly<Record<string, string | undefined>>,
  envOrNow?: Readonly<Record<string, string | undefined>> | Date,
  maybeNow?: Date,
): PreviewArtworkTransferRuntime {
  let request: Request | undefined;
  let env: Readonly<Record<string, string | undefined>>;
  let now: Date;

  if (requestOrEnv instanceof Request) {
    request = requestOrEnv;
    env = (envOrNow as Readonly<Record<string, string | undefined>>) ?? process.env;
    now = maybeNow ?? new Date();
  } else if (requestOrEnv && typeof requestOrEnv === "object" && !("url" in requestOrEnv)) {
    env = requestOrEnv as Readonly<Record<string, string | undefined>>;
    now = (envOrNow as Date) ?? new Date();
  } else {
    env = process.env;
    now = new Date();
  }

  const unavailable = (reason: string) => new PreviewArtworkTransferError(
    "TRANSFER_UNAVAILABLE",
    `Preview artwork transfer is unavailable: ${reason}.`,
    404,
  );

  if (env.VERCEL_ENV !== "preview") {
    throw unavailable("environment is not preview");
  }
  if (env.VERCEL_GIT_COMMIT_REF !== "develop") {
    throw unavailable("git commit ref is not develop");
  }
  if (env.ARTWORK_STORAGE_PROVIDER !== "vercel-blob") {
    throw unavailable("artwork storage provider is not vercel-blob");
  }
  if (env.PREVIEW_ARTWORK_TRANSFER_ENABLED !== "true") {
    throw unavailable("transfer is not enabled");
  }

  const expectedProjectId = env.PREVIEW_ARTWORK_TRANSFER_EXPECTED_PROJECT_ID?.trim();
  const projectId = env.VERCEL_PROJECT_ID?.trim();
  if (!projectId || !expectedProjectId || projectId !== expectedProjectId) {
    throw unavailable("project ID mismatch");
  }

  const expectedStoreId = env.PREVIEW_ARTWORK_TRANSFER_EXPECTED_STORE_ID?.trim();
  const storeId = env.BLOB_STORE_ID?.trim();
  if (!storeId || !expectedStoreId || storeId !== expectedStoreId) {
    throw unavailable("store ID mismatch");
  }

  const oidcToken = resolvePreviewArtworkOidcToken(request, env);
  if (!oidcToken) {
    throw unavailable("OIDC token unavailable");
  }

  const operatorSecretHash = env.PREVIEW_ARTWORK_TRANSFER_SECRET_HASH?.trim();
  if (!operatorSecretHash) {
    throw unavailable("operator secret hash is not configured");
  }

  const expiresAt = new Date(env.PREVIEW_ARTWORK_TRANSFER_EXPIRES_AT?.trim() ?? "");
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= now.getTime() ||
    expiresAt.getTime() - now.getTime() > PREVIEW_ARTWORK_TRANSFER_MAX_LIFETIME_MS
  ) {
    throw unavailable("transfer window expired or invalid");
  }

  try {
    validatePasswordHash(operatorSecretHash);
  } catch {
    throw unavailable("operator secret hash syntax invalid");
  }

  return {
    credentials: { oidcToken, storeId },
    operatorSecretHash,
    expiresAt,
    expectedProjectId,
    expectedStoreId,
  };
}

export async function verifyPreviewArtworkOperatorSecret(
  supplied: unknown,
  runtime: PreviewArtworkTransferRuntime,
): Promise<boolean> {
  try {
    return await verifyPassword(supplied, runtime.operatorSecretHash);
  } catch {
    return false;
  }
}

export async function loadPreviewArtworkManifest(
  client: PrismaClient,
  authenticatedSession: { sessionId: string; userId: string },
): Promise<PreviewArtworkManifestItem[]> {
  const [
    assets,
    characterCount,
    characterSourceCount,
    linkedCharacterCount,
    users,
    sessions,
    favoriteCount,
    cartCount,
    previewJobCount,
    bridgePairingCount,
    bridgeSessionCount,
    bridgeJobCount,
    sourceConnectionCount,
  ] = await Promise.all([
    client.artworkAsset.findMany({
      orderBy: { sha256: "asc" },
      select: {
        sha256: true,
        mediaType: true,
        byteLength: true,
        width: true,
        height: true,
        storageKey: true,
        _count: { select: { characters: true } },
      },
    }),
    client.character.count(),
    client.characterSource.count(),
    client.character.count({ where: { artworkSha256: { not: null } } }),
    client.user.findMany({
      orderBy: { id: "asc" },
      select: { id: true, username: true, role: true, accessStatus: true },
      take: 2,
    }),
    client.userSession.findMany({
      orderBy: { id: "asc" },
      select: { id: true, userId: true },
      take: 2,
    }),
    client.characterFavorite.count(),
    client.characterCartItem.count(),
    client.importPreviewJob.count(),
    client.bridgePairing.count(),
    client.bridgeSession.count(),
    client.bridgeJob.count(),
    client.sourceConnection.count(),
  ]);

  if (
    characterCount !== PREVIEW_CHARACTER_COUNT ||
    characterSourceCount !== PREVIEW_CHARACTER_SOURCE_COUNT ||
    linkedCharacterCount !== PREVIEW_ARTWORK_ASSET_COUNT ||
    assets.length !== PREVIEW_ARTWORK_ASSET_COUNT ||
    users.length !== 1 ||
    users[0]?.id !== "initial-admin" ||
    users[0]?.username !== "preview-admin" ||
    users[0]?.role !== "ADMIN" ||
    users[0]?.accessStatus !== "ACTIVE" ||
    sessions.length !== 1 ||
    sessions[0]?.id !== authenticatedSession.sessionId ||
    sessions[0]?.userId !== authenticatedSession.userId ||
    authenticatedSession.userId !== "initial-admin" ||
    favoriteCount !== 0 ||
    cartCount !== 0 ||
    previewJobCount !== 0 ||
    bridgePairingCount !== 0 ||
    bridgeSessionCount !== 0 ||
    bridgeJobCount !== 0 ||
    sourceConnectionCount !== 0
  ) {
    throw new PreviewArtworkTransferError(
      "PREVIEW_INVARIANT_MISMATCH",
      "Preview data does not match the approved artwork transfer manifest.",
      409,
    );
  }

  const manifest = assets.map((asset) => {
    const item = {
      sha256: asset.sha256,
      mediaType: asset.mediaType,
      byteLength: asset.byteLength,
      width: asset.width,
      height: asset.height,
      storageKey: asset.storageKey,
    };
    if (
      !ARTWORK_SHA256_PATTERN.test(item.sha256) ||
      item.mediaType !== "image/png" ||
      !Number.isSafeInteger(item.byteLength) ||
      item.byteLength <= 0 ||
      item.byteLength > PREVIEW_ARTWORK_MAX_BYTES ||
      !Number.isSafeInteger(item.width) || item.width <= 0 ||
      !Number.isSafeInteger(item.height) || item.height <= 0 ||
      item.storageKey !== finalArtworkStorageKey(item.sha256) ||
      asset._count.characters !== 1
    ) {
      throw new PreviewArtworkTransferError(
        "PREVIEW_INVARIANT_MISMATCH",
        "Preview artwork metadata does not match the approved transfer contract.",
        409,
      );
    }
    return item as PreviewArtworkManifestItem;
  });

  const linkedRelationships = assets.reduce((total, asset) => total + asset._count.characters, 0);
  if (linkedRelationships !== PREVIEW_ARTWORK_ASSET_COUNT) {
    throw new PreviewArtworkTransferError(
      "PREVIEW_INVARIANT_MISMATCH",
      "Preview artwork relationships do not match the approved transfer contract.",
      409,
    );
  }
  return manifest;
}

export async function loadApprovedPreviewArtwork(
  client: PrismaClient,
  digest: unknown,
): Promise<PreviewArtworkManifestItem> {
  const sha256 = typeof digest === "string" && ARTWORK_SHA256_PATTERN.test(digest) ? digest : null;
  if (!sha256) throw invalidRequest();
  const asset = await client.artworkAsset.findUnique({
    where: { sha256 },
    select: {
      sha256: true,
      mediaType: true,
      byteLength: true,
      width: true,
      height: true,
      storageKey: true,
      _count: { select: { characters: true } },
    },
  });
  if (!asset || asset._count.characters !== 1) throw invalidRequest();
  const expectedKey = finalArtworkStorageKey(asset.sha256);
  if (
    asset.mediaType !== "image/png" ||
    !Number.isSafeInteger(asset.byteLength) ||
    asset.byteLength <= 0 ||
    asset.byteLength > PREVIEW_ARTWORK_MAX_BYTES ||
    !Number.isSafeInteger(asset.width) || asset.width <= 0 ||
    !Number.isSafeInteger(asset.height) || asset.height <= 0 ||
    asset.storageKey !== expectedKey
  ) {
    throw invalidRequest();
  }
  return { ...asset, mediaType: "image/png", storageKey: expectedKey };
}

export async function issuePreviewArtworkUploadCapability(
  item: PreviewArtworkManifestItem,
  runtime: PreviewArtworkTransferRuntime,
  now = new Date(),
): Promise<string> {
  assertFinalArtworkStorageKey(item.storageKey);
  if (item.storageKey !== finalArtworkStorageKey(item.sha256)) throw invalidRequest();
  const validUntil = Math.min(
    now.getTime() + PREVIEW_ARTWORK_CAPABILITY_TTL_MS,
    runtime.expiresAt.getTime(),
  );
  if (validUntil <= now.getTime()) throw invalidRequest();
  const signed = await issueSignedToken({
    ...runtime.credentials,
    pathname: item.storageKey,
    operations: ["put"],
    validUntil,
    allowedContentTypes: ["image/png"],
    maximumSizeInBytes: item.byteLength,
  });
  const result = await presignUrl(signed, {
    access: "private",
    operation: "put",
    pathname: item.storageKey,
    validUntil,
    allowedContentTypes: ["image/png"],
    maximumSizeInBytes: item.byteLength,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 31_536_000,
  });
  return result.presignedUrl;
}

export async function verifyPreviewArtworkObject(
  item: PreviewArtworkManifestItem,
  runtime: PreviewArtworkTransferRuntime,
): Promise<void> {
  const store = new VercelBlobArtworkObjectStore(runtime.credentials);
  const bytes = await store.readFinal(item.storageKey);
  if (!bytes) throw objectMismatch();
  try {
    assertMetadataMatchesBytes(bytes, item);
  } catch {
    throw objectMismatch();
  }
}

export interface PreviewArtworkInventoryReconciliation {
  expected: number;
  present: number;
  missing: number;
  unexpected: number;
  presentDigests: string[];
  missingDigests: string[];
}

export async function reconcilePreviewArtworkInventory(
  manifest: readonly PreviewArtworkManifestItem[],
  runtime: PreviewArtworkTransferRuntime,
): Promise<PreviewArtworkInventoryReconciliation> {
  const expected = new Map(manifest.map((item) => [item.storageKey, item]));
  const present = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = await list({
      ...runtime.credentials,
      prefix: `${FINAL_ARTWORK_PREFIX}/`,
      limit: 250,
      ...(cursor ? { cursor } : {}),
    });
    for (const blob of page.blobs) {
      present.set(blob.pathname, blob.size);
      if (present.size > PREVIEW_ARTWORK_ASSET_COUNT) break;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && present.size <= PREVIEW_ARTWORK_ASSET_COUNT);

  const presentDigests: string[] = [];
  const missingDigests: string[] = [];

  for (const item of manifest) {
    const size = present.get(item.storageKey);
    if (size === item.byteLength) {
      presentDigests.push(item.sha256);
    } else {
      missingDigests.push(item.sha256);
    }
  }

  const unexpected = [...present].filter(([pathname, size]) => {
    const expectedItem = expected.get(pathname);
    return !expectedItem || expectedItem.byteLength !== size;
  }).length;

  return {
    expected: manifest.length,
    present: presentDigests.length,
    missing: missingDigests.length,
    unexpected,
    presentDigests,
    missingDigests,
  };
}

function invalidRequest(): PreviewArtworkTransferError {
  return new PreviewArtworkTransferError(
    "INVALID_TRANSFER_REQUEST",
    "The artwork transfer request is invalid.",
    400,
  );
}

function objectMismatch(): PreviewArtworkTransferError {
  return new PreviewArtworkTransferError(
    "ARTWORK_VERIFICATION_FAILED",
    "The stored artwork does not match the approved metadata.",
    409,
  );
}

const PROOF_DOMAIN_INFO = "CharacterArchive:PreviewArtworkTransfer:ProofSigningKey:v1";

export interface VerificationProofPayload {
  projectId: string;
  storeId: string;
  expectedCount: number;
  presentCount: number;
  missingCount: number;
  unexpectedCount: number;
  verifiedDigests: string[];
  issuedAt: number;
  expiresAt: number;
}

/**
 * Derives a dedicated 256-bit proof-signing key from the server-side operatorSecretHash,
 * bound to the specific Vercel projectId and storeId with explicit domain separation.
 *
 * Security Contract (Requirement 4 & 5):
 * - Does NOT use the raw password hash directly as an HMAC key.
 * - Uses RFC 5869 HKDF to derive a fresh independent cryptographic key.
 * - Salt binds to `preview-transfer-proof-salt:${projectId}:${storeId}`.
 * - Info string binds domain `CharacterArchive:PreviewArtworkTransfer:ProofSigningKey:v1`.
 */
export function deriveProofSigningKey(
  operatorSecretHash: string,
  storeId: string,
  projectId: string,
): Buffer {
  const salt = Buffer.from(`preview-transfer-proof-salt:${projectId}:${storeId}`, "utf-8");
  const ikm = Buffer.from(operatorSecretHash, "utf-8");
  const info = Buffer.from(PROOF_DOMAIN_INFO, "utf-8");
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

export function issueVerificationProof(
  verifiedDigests: readonly string[],
  inventory: PreviewArtworkInventoryReconciliation,
  runtime: PreviewArtworkTransferRuntime,
  now = new Date(),
): string {
  const sortedDigests = Array.from(new Set(verifiedDigests)).sort();
  const issuedAt = now.getTime();
  const expiresAt = Math.min(
    issuedAt + PREVIEW_VERIFICATION_PROOF_MAX_TTL_MS,
    runtime.expiresAt.getTime(),
  );

  const payload: VerificationProofPayload = {
    projectId: runtime.expectedProjectId,
    storeId: runtime.expectedStoreId,
    expectedCount: inventory.expected,
    presentCount: inventory.present,
    missingCount: inventory.missing,
    unexpectedCount: inventory.unexpected,
    verifiedDigests: sortedDigests,
    issuedAt,
    expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signingKey = deriveProofSigningKey(
    runtime.operatorSecretHash,
    runtime.expectedStoreId,
    runtime.expectedProjectId,
  );
  const signature = createHmac("sha256", signingKey).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

export function verifyVerificationProof(
  token: unknown,
  inventory: PreviewArtworkInventoryReconciliation,
  runtime: PreviewArtworkTransferRuntime,
  now = new Date(),
): VerificationProofPayload {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Verification proof token is malformed.", 400);
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Verification proof token is malformed.", 400);
  }
  const [payloadB64, signature] = parts;

  const signingKey = deriveProofSigningKey(
    runtime.operatorSecretHash,
    runtime.expectedStoreId,
    runtime.expectedProjectId,
  );
  const expectedSignature = createHmac("sha256", signingKey).update(payloadB64).digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Verification proof signature is invalid.", 400);
  }

  let payload: VerificationProofPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Verification proof payload is invalid JSON.", 400);
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    payload.projectId !== runtime.expectedProjectId ||
    payload.storeId !== runtime.expectedStoreId
  ) {
    throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Verification proof context mismatch.", 400);
  }

  if (now.getTime() > payload.expiresAt || payload.expiresAt > runtime.expiresAt.getTime()) {
    throw new PreviewArtworkTransferError("PROOF_EXPIRED", "Verification proof has expired.", 400);
  }

  if (
    payload.expectedCount !== inventory.expected ||
    payload.presentCount !== inventory.present ||
    payload.missingCount !== inventory.missing ||
    payload.unexpectedCount !== inventory.unexpected ||
    payload.unexpectedCount !== 0
  ) {
    throw new PreviewArtworkTransferError("INVENTORY_MUTATED", "Verification proof inventory state does not match live storage.", 409);
  }

  if (!Array.isArray(payload.verifiedDigests)) {
    throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Verification proof digests are invalid.", 400);
  }

  const presentSet = new Set(inventory.presentDigests);
  for (const digest of payload.verifiedDigests) {
    if (typeof digest !== "string" || !ARTWORK_SHA256_PATTERN.test(digest) || !presentSet.has(digest)) {
      throw new PreviewArtworkTransferError("INVALID_PROOF_TOKEN", "Proof contains unverified or unapproved digest.", 400);
    }
  }

  return payload;
}
