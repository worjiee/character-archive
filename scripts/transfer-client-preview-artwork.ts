import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import { Pool } from "pg";
import {
  assertFinalArtworkStorageKey,
  assertMetadataMatchesBytes,
  finalArtworkStorageKey,
} from "../src/lib/artwork";
import type { PreviewArtworkManifestItem } from "../src/lib/artwork/preview-transfer";
import { USER_SESSION_COOKIE } from "../src/lib/auth";

const EXPECTED_ASSET_COUNT = 83;
const MAX_CONTROL_RESPONSE_BYTES = 128 * 1024;
const PREVIEW_ADMIN_USERNAME = "preview-admin";

export interface OperatorSession {
  origin: string;
  cookie: string;
  operatorSecret: string;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const previewUrl = requiredEnvironmentValue("CLIENT_PREVIEW_URL");
  const adminPassword = takeSecret("PREVIEW_ADMIN_PASSWORD");
  const operatorSecret = takeSecret("PREVIEW_ARTWORK_TRANSFER_SECRET");
  const origin = validatePreviewOrigin(previewUrl);
  const local = parse(await readFile(".env"));
  const databaseUrl = local.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("The accepted local database is not configured.");
  const database = new URL(databaseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(database.hostname)) {
    throw new Error("Artwork source must be the accepted local PostgreSQL database.");
  }

  const approved = await readAndValidateLocalManifest(databaseUrl);
  const cookie = await login(origin, adminPassword);
  const session = { origin, cookie, operatorSecret };
  try {
    const preflight = await control(session, { action: "preflight" });
    const remoteManifest = readManifest(preflight);
    if (!sameManifest(approved, remoteManifest)) {
      throw new Error("Local artwork metadata does not match the approved Preview manifest.");
    }
    const preflightInventory = readInventory(preflight);
    if (preflightInventory.unexpected !== 0) {
      throw new Error("Unexpected objects exist in Preview artwork storage.");
    }

    const presentDigests = Array.isArray(preflight.presentDigests) ? (preflight.presentDigests as string[]) : [];
    const missingDigests = Array.isArray(preflight.missingDigests) ? (preflight.missingDigests as string[]) : [];
    if (
      preflightInventory.present !== presentDigests.length ||
      preflightInventory.missing !== missingDigests.length ||
      preflightInventory.expected !== EXPECTED_ASSET_COUNT
    ) {
      throw new Error("Preflight inventory counts do not match digest lists.");
    }

    const itemsToUpload = approved.filter((item) => missingDigests.includes(item.sha256));
    if (itemsToUpload.length !== preflightInventory.missing) {
      throw new Error("Missing item count does not match filtered manifest.");
    }
    for (const presentDigest of presentDigests) {
      if (itemsToUpload.some((item) => item.sha256 === presentDigest)) {
        throw new Error("Attempted to upload an already-present object.");
      }
    }

    let proofToken: string | undefined = undefined;

    if (presentDigests.length > 0) {
      console.log(JSON.stringify({ resume: true, present: presentDigests.length, missing: missingDigests.length }));
      const batchSize = 8;
      for (let i = 0; i < presentDigests.length; i += batchSize) {
        const batch = presentDigests.slice(i, i + batchSize);
        const batchRes = await control(session, {
          action: "verify-batch",
          digests: batch,
          ...(proofToken ? { proofToken } : {}),
        });
        if (typeof batchRes.proofToken !== "string") {
          throw new Error("Verification batch did not return a valid proof token.");
        }
        proofToken = batchRes.proofToken;
        console.log(JSON.stringify({
          verifyBatchProgress: Math.min(i + batch.length, presentDigests.length),
          totalPresent: presentDigests.length,
        }));
      }
    }

    let uploaded = presentDigests.length;
    let verified = presentDigests.length;

    for (const item of itemsToUpload) {
      await sleep(500);
      const bytes = new Uint8Array(await readFile(localArtworkPath(item.storageKey)));
      assertMetadataMatchesBytes(bytes, item);
      const capabilityResponse = await control(session, {
        action: "capability",
        sha256: item.sha256,
        ...(proofToken ? { proofToken } : {}),
      });
      const capabilityUrl = readCapabilityUrl(capabilityResponse, item.sha256);

      const uploadResult = await uploadWithRetry(session, capabilityUrl, bytes, item, fetch, sleep, control, proofToken);
      uploaded += 1;

      if (uploadResult.proofToken) {
        proofToken = uploadResult.proofToken;
        verified += 1;
      } else {
        const verification = await control(session, {
          action: "verify",
          sha256: item.sha256,
          ...(proofToken ? { proofToken } : {}),
        });
        if (verification.sha256 !== item.sha256 || verification.verified !== true) {
          throw new Error("A Preview artwork verification response was invalid.");
        }
        if (typeof verification.proofToken === "string") {
          proofToken = verification.proofToken;
        }
        verified += 1;
      }
      if (uploaded % 10 === 0 || uploaded === approved.length) {
        console.log(JSON.stringify({ progress: uploaded, total: approved.length }));
      }
    }

    const finalInventory = readInventory(await control(session, { action: "inventory" }));
    if (
      finalInventory.expected !== EXPECTED_ASSET_COUNT ||
      finalInventory.present !== EXPECTED_ASSET_COUNT ||
      finalInventory.missing !== 0 ||
      finalInventory.unexpected !== 0
    ) {
      throw new Error("Final Preview artwork inventory did not reconcile.");
    }
    console.log(JSON.stringify({ uploaded, verified, inventory: finalInventory }));
  } finally {
    await logout(session).catch(() => undefined);
  }
}

async function readAndValidateLocalManifest(connectionString: string): Promise<PreviewArtworkManifestItem[]> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const result = await pool.query<PreviewArtworkManifestItem & { relationshipCount: number }>(
      `SELECT a.sha256, a."mediaType", a."byteLength", a.width, a.height, a."storageKey",
              COUNT(c.id)::int AS "relationshipCount"
       FROM "ArtworkAsset" a
       LEFT JOIN "Character" c ON c."artworkSha256" = a.sha256
       GROUP BY a.sha256, a."mediaType", a."byteLength", a.width, a.height, a."storageKey"
       ORDER BY a.sha256`,
    );
    if (result.rows.length !== EXPECTED_ASSET_COUNT) {
      throw new Error("The accepted local artwork manifest does not contain exactly 83 objects.");
    }
    const items = result.rows.map(({ relationshipCount, ...item }) => {
      assertFinalArtworkStorageKey(item.storageKey);
      if (
        item.mediaType !== "image/png" ||
        item.storageKey !== finalArtworkStorageKey(item.sha256) ||
        relationshipCount !== 1
      ) {
        throw new Error("The accepted local artwork manifest is not internally consistent.");
      }
      return { ...item, mediaType: "image/png" as const };
    });
    for (const item of items) {
      const bytes = new Uint8Array(await readFile(localArtworkPath(item.storageKey)));
      assertMetadataMatchesBytes(bytes, item);
    }
    return items;
  } finally {
    await pool.end();
  }
}

async function login(origin: string, password: string): Promise<string> {
  const response = await fetch(`${origin}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({ username: PREVIEW_ADMIN_USERNAME, password, redirectTo: "/" }),
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error("Preview administrator authentication failed.");
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const cookie = setCookies
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith(`${USER_SESSION_COOKIE}=`));
  if (!cookie) throw new Error("Preview administrator authentication did not issue a session.");
  return cookie;
}

async function logout(session: OperatorSession): Promise<void> {
  await fetch(`${session.origin}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: session.cookie, Origin: session.origin },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
}

export async function control(session: OperatorSession, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${session.origin}/api/admin/preview-artwork-transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      Origin: session.origin,
      "x-preview-artwork-transfer-secret": session.operatorSecret,
    },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CONTROL_RESPONSE_BYTES) {
    throw new Error("The Preview transfer control response exceeded its bound.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The Preview transfer control response was invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The Preview transfer control request was rejected.");
  }
  const record = value as Record<string, unknown>;
  if (!response.ok) {
    const error = record.error;
    const code = error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>).code
      : null;
    const message = error && typeof error === "object" && !Array.isArray(error)
      ? (error as Record<string, unknown>).message
      : null;
    if (code === "BLOB_AUTH_FORBIDDEN") throw new Error("Preview Blob authorization returned 403.");
    throw new Error(`The Preview transfer control request was rejected (HTTP ${response.status}: ${code ?? "UNKNOWN"}${message ? ` - ${message}` : ""}).`);
  }
  return record;
}

export async function uploadWithRetry(
  session: OperatorSession,
  capabilityUrl: string,
  bytes: Uint8Array,
  item: PreviewArtworkManifestItem,
  fetchFn: typeof fetch = fetch,
  sleepFn: (ms: number) => Promise<void> = sleep,
  controlFn: (s: OperatorSession, b: Record<string, unknown>) => Promise<Record<string, unknown>> = control,
  proofToken?: string,
): Promise<{ proofToken?: string }> {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let errorStatus: number | null = null;
    let retryAfterSeconds: number | null = null;
    try {
      const upload = await fetchFn(capabilityUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png", "Content-Length": String(bytes.byteLength) },
        body: Buffer.from(bytes),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      if (upload.ok) {
        return {};
      }
      errorStatus = upload.status;
      const retryHeader = upload.headers.get("Retry-After");
      if (retryHeader) {
        const parsed = parseInt(retryHeader, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
          retryAfterSeconds = Math.min(parsed, 30);
        }
      }
    } catch {
      // Network error or timeout: treated as ambiguous transient error
    }

    // Permanent failure: immediate hard stop (no retry)
    if (errorStatus !== null && [400, 401, 403, 404, 409].includes(errorStatus)) {
      throw new Error(`Artwork upload failed with non-retryable HTTP ${errorStatus}.`);
    }

    // Ambiguous write handling:
    // Before retrying after an ambiguous network/5xx failure, check whether that exact object
    // now exists and verifies successfully, because the server may have committed the PUT
    // despite the client receiving an error or timeout.
    try {
      const verifyCheck = await controlFn(session, {
        action: "verify",
        sha256: item.sha256,
        ...(proofToken ? { proofToken } : {}),
      });
      if (verifyCheck.sha256 === item.sha256 && verifyCheck.verified === true) {
        return {
          proofToken: typeof verifyCheck.proofToken === "string" ? verifyCheck.proofToken : proofToken,
        };
      }
    } catch {
      // Object not yet present or verified; proceed with retry
    }

    if (attempt === maxAttempts) {
      throw new Error(`Artwork upload failed after ${maxAttempts} attempts.`);
    }

    // Bounded exponential backoff with jitter
    const baseDelay = retryAfterSeconds !== null
      ? retryAfterSeconds * 1000
      : Math.min(1000 * Math.pow(2, attempt), 10_000);
    const jitter = Math.floor(Math.random() * 500);
    const delay = baseDelay + jitter;
    await sleepFn(delay);
  }
  return {};
}

function readManifest(value: Record<string, unknown>): PreviewArtworkManifestItem[] {
  if (!Array.isArray(value.manifest) || value.manifest.length !== EXPECTED_ASSET_COUNT) {
    throw new Error("The Preview artwork manifest response was invalid.");
  }
  return value.manifest.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("The Preview artwork manifest response was invalid.");
    const record = item as Record<string, unknown>;
    if (
      typeof record.sha256 !== "string" ||
      record.mediaType !== "image/png" ||
      typeof record.byteLength !== "number" ||
      typeof record.width !== "number" ||
      typeof record.height !== "number" ||
      typeof record.storageKey !== "string"
    ) throw new Error("The Preview artwork manifest response was invalid.");
    assertFinalArtworkStorageKey(record.storageKey);
    if (record.storageKey !== finalArtworkStorageKey(record.sha256)) {
      throw new Error("The Preview artwork manifest response was invalid.");
    }
    return {
      sha256: record.sha256,
      mediaType: "image/png",
      byteLength: record.byteLength,
      width: record.width,
      height: record.height,
      storageKey: record.storageKey,
    };
  });
}

function readInventory(value: Record<string, unknown>): { expected: number; present: number; missing: number; unexpected: number } {
  if (!value.inventory || typeof value.inventory !== "object" || Array.isArray(value.inventory)) {
    throw new Error("The Preview artwork inventory response was invalid.");
  }
  const inventory = value.inventory as Record<string, unknown>;
  for (const key of ["expected", "present", "missing", "unexpected"] as const) {
    if (typeof inventory[key] !== "number" || !Number.isSafeInteger(inventory[key])) {
      throw new Error("The Preview artwork inventory response was invalid.");
    }
  }
  return inventory as { expected: number; present: number; missing: number; unexpected: number };
}

export function readCapabilityUrl(value: Record<string, unknown>, expectedDigest: string): string {
  if (value.sha256 !== expectedDigest || typeof value.capabilityUrl !== "string") {
    throw new Error("The Preview artwork capability response was invalid.");
  }
  const url = new URL(value.capabilityUrl);
  const expectedKey = `artwork/sha256/${expectedDigest}.png`;

  if (url.protocol !== "https:") {
    throw new Error("The Preview artwork capability target was invalid.");
  }

  const isVercelBlobCdn = url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com");
  const isVercelBlobApi = (url.hostname === "vercel.com" || url.hostname === "api.vercel.com") && url.pathname.startsWith("/api/blob");

  if (!isVercelBlobCdn && !isVercelBlobApi) {
    throw new Error("The Preview artwork capability target was invalid.");
  }

  const targetPath = url.searchParams.get("pathname") || (url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname);
  if (targetPath !== expectedKey) {
    throw new Error("The Preview artwork capability target was invalid.");
  }

  return url.toString();
}

function sameManifest(left: readonly PreviewArtworkManifestItem[], right: readonly PreviewArtworkManifestItem[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function localArtworkPath(storageKey: string): string {
  assertFinalArtworkStorageKey(storageKey);
  return path.resolve(process.cwd(), ".var", "artwork", ...storageKey.split("/"));
}

function validatePreviewOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".vercel.app") ||
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw new Error("CLIENT_PREVIEW_URL must be an exact HTTPS Vercel Preview origin.");
  }
  return url.origin;
}

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function takeSecret(name: string): string {
  const value = requiredEnvironmentValue(name);
  delete process.env[name];
  return value;
}

if (process.env.NODE_ENV !== "test") {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Preview artwork transfer failed.");
    process.exitCode = 1;
  });
}
