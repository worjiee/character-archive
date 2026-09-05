import { createHash, createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { issueSignedToken, list, presignUrl } from "@vercel/blob";
import {
  APPROVED_271_BY_DIGEST,
  BASELINE_83_DIGESTS,
  BASELINE_83_SET,
} from "./large-catalog-manifest";
import {
  readVercelBlobCredentials,
  VercelBlobArtworkObjectStore,
} from "./vercel-blob-store";
import { finalArtworkStorageKey, FINAL_ARTWORK_PREFIX } from "./local-store";

export const LARGE_CATALOG_CAPABILITY_TTL_MS = 5 * 60 * 1_000;
export const LARGE_CATALOG_PROOF_MAX_TTL_MS = 30 * 60 * 1_000;
export const LARGE_CATALOG_VERIFY_BYTES_BATCH_MAX = 30;
export const PROOF_DOMAIN_INFO = "chikpeas:large-catalog-preview-transfer:proof:v1";

export type LargeCatalogTransferErrorCode =
  | "PREVIEW_ONLY"
  | "UNAUTHORIZED"
  | "BASELINE_ASSET_IMMUTABLE"
  | "UNAPPROVED_DIGEST"
  | "ALREADY_PRESENT"
  | "NOT_PRESENT"
  | "BYTE_VERIFICATION_FAILED"
  | "INVENTORY_MUTATED"
  | "INVALID_PROOF_TOKEN"
  | "PROOF_EXPIRED"
  | "PREVERIFICATION_REQUIRED"
  | "INVALID_REQUEST";

export class LargeCatalogTransferError extends Error {
  readonly code: LargeCatalogTransferErrorCode;
  readonly status: number;

  constructor(code: LargeCatalogTransferErrorCode, message: string, status = 400) {
    super(message);
    this.name = "LargeCatalogTransferError";
    this.code = code;
    this.status = status;
  }
}

export interface InventoryReconciliation {
  expected: number;
  baselineExpected: number;
  baselinePresent: number;
  newExpected: number;
  newPresent: number;
  newMissing: number;
  unexpected: number;
  presentDigests: string[];
  missingDigests: string[];
}

export interface VerificationProofPayload {
  storeId: string;
  expectedCount: number;
  presentCount: number;
  missingCount: number;
  unexpectedCount: number;
  verifiedDigests: string[];
  issuedAt: number;
  expiresAt: number;
}

export function assertPreviewEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const vercelEnv = env.VERCEL_ENV?.trim().toLowerCase();
  const isPreview = vercelEnv === "preview" || env.PREVIEW_LARGE_CATALOG_ALLOWED === "true";
  if (!isPreview) {
    throw new LargeCatalogTransferError(
      "PREVIEW_ONLY",
      "Large-catalog artwork transfer is strictly restricted to the Preview environment.",
      404,
    );
  }
}

export function assertOperatorAuthorized(
  operatorSecretHeader: string | null | undefined,
  expectedSecretHash: string | undefined,
): void {
  if (!expectedSecretHash) {
    throw new LargeCatalogTransferError("UNAUTHORIZED", "Operator authorization secret is not configured.", 401);
  }
  if (!operatorSecretHeader || typeof operatorSecretHeader !== "string") {
    throw new LargeCatalogTransferError("UNAUTHORIZED", "Operator authorization header is missing.", 401);
  }
  const providedHash = createHash("sha256").update(operatorSecretHeader, "utf8").digest("hex");
  const providedBuf = Buffer.from(providedHash, "utf8");
  const expectedBuf = Buffer.from(expectedSecretHash, "utf8");
  if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
    throw new LargeCatalogTransferError("UNAUTHORIZED", "Operator authorization failed.", 401);
  }
}

export async function reconcileLiveInventory(
  credentials = readVercelBlobCredentials(),
): Promise<InventoryReconciliation> {
  const presentDigests = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await list({
      ...credentials,
      prefix: `${FINAL_ARTWORK_PREFIX}/`,
      limit: 250,
      ...(cursor ? { cursor } : {}),
    });

    for (const blob of page.blobs) {
      const match = /^artwork\/sha256\/([0-9a-f]{64})\.png$/.exec(blob.pathname);
      if (match) {
        presentDigests.add(match[1]);
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  let baselinePresent = 0;
  for (const digest of BASELINE_83_DIGESTS) {
    if (presentDigests.has(digest)) {
      baselinePresent++;
    }
  }

  let newPresent = 0;
  const missingDigests: string[] = [];
  for (const digest of APPROVED_271_BY_DIGEST.keys()) {
    if (presentDigests.has(digest)) {
      newPresent++;
    } else {
      missingDigests.push(digest);
    }
  }

  let unexpected = 0;
  for (const digest of presentDigests) {
    if (!BASELINE_83_SET.has(digest) && !APPROVED_271_BY_DIGEST.has(digest)) {
      unexpected++;
    }
  }

  return {
    expected: 83 + 271, // 354
    baselineExpected: 83,
    baselinePresent,
    newExpected: 271,
    newPresent,
    newMissing: missingDigests.length,
    unexpected,
    presentDigests: Array.from(presentDigests).sort(),
    missingDigests: missingDigests.sort(),
  };
}

export async function issueUploadCapability(
  digest: string,
  credentials = readVercelBlobCredentials(),
  now = new Date(),
): Promise<{ presignedUrl: string; sha256: string; byteLength: number; expiresInSeconds: number }> {
  // Layer 1: Baseline rejection
  if (BASELINE_83_SET.has(digest)) {
    throw new LargeCatalogTransferError(
      "BASELINE_ASSET_IMMUTABLE",
      `Artwork digest ${digest} belongs to the immutable 83 baseline objects and cannot be modified or re-uploaded.`,
      409,
    );
  }

  // Layer 2: Approved whitelist check
  const entry = APPROVED_271_BY_DIGEST.get(digest);
  if (!entry) {
    throw new LargeCatalogTransferError(
      "UNAPPROVED_DIGEST",
      `Artwork digest ${digest} is not in the approved 271-object manifest.`,
      403,
    );
  }

  const storageKey = finalArtworkStorageKey(entry.sha256);
  const validUntil = now.getTime() + LARGE_CATALOG_CAPABILITY_TTL_MS;

  const signed = await issueSignedToken({
    ...credentials,
    pathname: storageKey,
    operations: ["put"],
    validUntil,
    allowedContentTypes: ["image/png"],
    maximumSizeInBytes: entry.byteLength,
  });

  const presigned = await presignUrl(signed, {
    access: "private",
    operation: "put",
    pathname: storageKey,
    validUntil,
    allowedContentTypes: ["image/png"],
    maximumSizeInBytes: entry.byteLength,
    addRandomSuffix: false,
    allowOverwrite: false,
    cacheControlMaxAge: 31_536_000,
  });

  return {
    presignedUrl: presigned.presignedUrl,
    sha256: entry.sha256,
    byteLength: entry.byteLength,
    expiresInSeconds: Math.floor(LARGE_CATALOG_CAPABILITY_TTL_MS / 1000),
  };
}

export async function verifyUploadedObjectHead(
  digest: string,
  credentials = readVercelBlobCredentials(),
): Promise<{ verified: true; sha256: string; byteLength: number }> {
  const entry = APPROVED_271_BY_DIGEST.get(digest);
  if (!entry) {
    throw new LargeCatalogTransferError("UNAPPROVED_DIGEST", `Digest ${digest} is not approved.`, 403);
  }

  const store = new VercelBlobArtworkObjectStore(credentials);
  const storageKey = finalArtworkStorageKey(entry.sha256);
  const exists = await store.statFinal(storageKey);
  if (!exists) {
    throw new LargeCatalogTransferError(
      "NOT_PRESENT",
      `Object ${storageKey} is not present in storage or exceeds bounds.`,
      400,
    );
  }

  return { verified: true, sha256: entry.sha256, byteLength: entry.byteLength };
}

export async function verifyBoundedBytesBatch(
  digests: readonly string[],
  credentials = readVercelBlobCredentials(),
): Promise<{
  verifiedDigests: string[];
  failedDigests: Array<{ digest: string; error: string }>;
}> {
  if (digests.length > LARGE_CATALOG_VERIFY_BYTES_BATCH_MAX) {
    throw new LargeCatalogTransferError(
      "INVALID_REQUEST",
      `Batch byte-verification is bounded to at most ${LARGE_CATALOG_VERIFY_BYTES_BATCH_MAX} objects per call.`,
      400,
    );
  }

  const store = new VercelBlobArtworkObjectStore(credentials);
  const verifiedDigests: string[] = [];
  const failedDigests: Array<{ digest: string; error: string }> = [];

  for (const digest of digests) {
    const entry = APPROVED_271_BY_DIGEST.get(digest);
    if (!entry) {
      failedDigests.push({ digest, error: "Digest not in approved manifest." });
      continue;
    }

    const storageKey = finalArtworkStorageKey(entry.sha256);
    try {
      const bytes = await store.readFinal(storageKey);
      if (!bytes) {
        failedDigests.push({ digest, error: "Blob bytes could not be retrieved from storage." });
        continue;
      }
      if (bytes.byteLength !== entry.byteLength) {
        failedDigests.push({
          digest,
          error: `Byte length mismatch: expected ${entry.byteLength}, got ${bytes.byteLength}.`,
        });
        continue;
      }
      const actualHash = createHash("sha256").update(bytes).digest("hex");
      if (actualHash !== entry.sha256) {
        failedDigests.push({
          digest,
          error: `Cryptographic SHA-256 mismatch: expected ${entry.sha256}, got ${actualHash}.`,
        });
        continue;
      }
      verifiedDigests.push(entry.sha256);
    } catch (err) {
      failedDigests.push({
        digest,
        error: err instanceof Error ? err.message : "Unknown error reading blob bytes.",
      });
    }
  }

  return { verifiedDigests, failedDigests };
}

function deriveProofSigningKey(operatorSecretHash: string, storeId: string): Buffer {
  const salt = Buffer.from(storeId, "utf-8");
  const ikm = Buffer.from(operatorSecretHash, "utf-8");
  const info = Buffer.from(PROOF_DOMAIN_INFO, "utf-8");
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

export function issueVerificationProof(
  verifiedDigests: readonly string[],
  inventory: InventoryReconciliation,
  operatorSecretHash: string,
  storeId = "store_FVTNEmPs2f8nzsGq",
  now = new Date(),
): string {
  const sortedDigests = Array.from(new Set(verifiedDigests)).sort();
  const issuedAt = now.getTime();
  const expiresAt = issuedAt + LARGE_CATALOG_PROOF_MAX_TTL_MS;

  const payload: VerificationProofPayload = {
    storeId,
    expectedCount: inventory.expected,
    presentCount: inventory.presentDigests.length,
    missingCount: inventory.newMissing,
    unexpectedCount: inventory.unexpected,
    verifiedDigests: sortedDigests,
    issuedAt,
    expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signingKey = deriveProofSigningKey(operatorSecretHash, storeId);
  const signature = createHmac("sha256", signingKey).update(payloadB64).digest("base64url");
  return `${payloadB64}.${signature}`;
}

export function verifyVerificationProof(
  token: unknown,
  operatorSecretHash: string,
  storeId = "store_FVTNEmPs2f8nzsGq",
  now = new Date(),
): VerificationProofPayload {
  if (typeof token !== "string" || !token.includes(".")) {
    throw new LargeCatalogTransferError("INVALID_PROOF_TOKEN", "Verification proof token is malformed.", 400);
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new LargeCatalogTransferError("INVALID_PROOF_TOKEN", "Verification proof token is malformed.", 400);
  }
  const [payloadB64, signature] = parts;

  const signingKey = deriveProofSigningKey(operatorSecretHash, storeId);
  const expectedSignature = createHmac("sha256", signingKey).update(payloadB64).digest("base64url");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    throw new LargeCatalogTransferError("INVALID_PROOF_TOKEN", "Verification proof signature is invalid.", 400);
  }

  let payload: VerificationProofPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
  } catch {
    throw new LargeCatalogTransferError("INVALID_PROOF_TOKEN", "Verification proof payload is invalid JSON.", 400);
  }

  if (now.getTime() > payload.expiresAt) {
    throw new LargeCatalogTransferError("PROOF_EXPIRED", "Verification proof has expired.", 400);
  }

  return payload;
}
