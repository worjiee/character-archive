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

interface OperatorSession {
  origin: string;
  cookie: string;
  operatorSecret: string;
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
    if (preflightInventory.present !== 0 || preflightInventory.unexpected !== 0) {
      throw new Error("The managed Preview artwork prefix is not empty.");
    }

    let uploaded = 0;
    let verified = 0;
    for (const item of approved) {
      const bytes = new Uint8Array(await readFile(localArtworkPath(item.storageKey)));
      assertMetadataMatchesBytes(bytes, item);
      const capabilityResponse = await control(session, { action: "capability", sha256: item.sha256 });
      const capabilityUrl = readCapabilityUrl(capabilityResponse, item.sha256);
      const upload = await fetch(capabilityUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/png", "Content-Length": String(bytes.byteLength) },
        body: Buffer.from(bytes),
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
      });
      if (!upload.ok) throw new Error("A private artwork upload was rejected.");
      uploaded += 1;
      const verification = await control(session, { action: "verify", sha256: item.sha256 });
      if (verification.sha256 !== item.sha256 || verification.verified !== true) {
        throw new Error("A Preview artwork verification response was invalid.");
      }
      verified += 1;
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

async function control(session: OperatorSession, body: Record<string, unknown>): Promise<Record<string, unknown>> {
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
    if (code === "BLOB_AUTH_FORBIDDEN") throw new Error("Preview Blob authorization returned 403.");
    throw new Error("The Preview transfer control request was rejected.");
  }
  return record;
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

function readCapabilityUrl(value: Record<string, unknown>, expectedDigest: string): string {
  if (value.sha256 !== expectedDigest || typeof value.capabilityUrl !== "string") {
    throw new Error("The Preview artwork capability response was invalid.");
  }
  const url = new URL(value.capabilityUrl);
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "blob.vercel-storage.com" || url.hostname.endsWith(".blob.vercel-storage.com"))
  ) {
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

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Preview artwork transfer failed.");
  process.exitCode = 1;
});
