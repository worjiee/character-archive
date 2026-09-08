import { createHash, randomUUID } from "node:crypto";
import {
  ArtworkStorageError,
  assertFinalArtworkStorageKey,
  assertMetadataMatchesBytes,
  assertPendingArtworkStorageKey,
  finalArtworkStorageKey,
  PENDING_ARTWORK_PREFIX,
} from "./local-store";
import type {
  ArtworkMetadata,
  ArtworkObjectStore,
  PendingArtworkBinding,
  PromotedArtwork,
} from "./types";

const MAX_ARTWORK_OBJECT_BYTES = 32 * 1024 * 1024;
const DEFAULT_CLEANUP_LIMIT = 50;
const MAX_CLEANUP_SCAN = 1_000;
export const DEFAULT_SUPABASE_ARTWORK_BUCKET = "character-archive-artwork";

export interface SupabaseStorageCredentials {
  url: string;
  serviceRoleKey: string;
}

export interface SupabaseStorageOperations {
  get(bucket: string, pathname: string): Promise<Uint8Array | null>;
  put(bucket: string, pathname: string, bytes: Uint8Array, options?: { upsert?: boolean }): Promise<void>;
  head(bucket: string, pathname: string): Promise<{ size: number } | null>;
  delete(bucket: string, pathnames: string[]): Promise<void>;
  list(bucket: string, prefix: string, limit?: number, offset?: number): Promise<Array<{ name: string; id: string }>>;
}

const defaultOperations: SupabaseStorageOperations = {
  get: async (bucket, pathname) => {
    const creds = readSupabaseCredentials();
    const url = `${creds.url}/storage/v1/object/authenticated/${bucket}/${pathname}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.serviceRoleKey}`,
        apikey: creds.serviceRoleKey,
      },
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      throw new ArtworkStorageError(`Supabase Storage get failed with status ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },
  put: async (bucket, pathname, bytes, options = { upsert: true }) => {
    const creds = readSupabaseCredentials();
    const url = `${creds.url}/storage/v1/object/${bucket}/${pathname}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.serviceRoleKey}`,
        apikey: creds.serviceRoleKey,
        "Content-Type": "image/png",
        "x-upsert": options.upsert ? "true" : "false",
      },
      body: Buffer.from(bytes),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ArtworkStorageError(`Supabase Storage put failed (${res.status}): ${errText}`);
    }
  },
  head: async (bucket, pathname) => {
    const creds = readSupabaseCredentials();
    const url = `${creds.url}/storage/v1/object/info/authenticated/${bucket}/${pathname}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.serviceRoleKey}`,
        apikey: creds.serviceRoleKey,
      },
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) {
      throw new ArtworkStorageError(`Supabase Storage info failed with status ${res.status}`);
    }
    const data = await res.json();
    const size = data?.size ?? data?.metadata?.size;
    return typeof size === "number" ? { size } : null;
  },
  delete: async (bucket, pathnames) => {
    if (pathnames.length === 0) return;
    const creds = readSupabaseCredentials();
    const url = `${creds.url}/storage/v1/object/${bucket}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${creds.serviceRoleKey}`,
        apikey: creds.serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefixes: pathnames }),
    });
    if (!res.ok && res.status !== 404) {
      const errText = await res.text().catch(() => "");
      throw new ArtworkStorageError(`Supabase Storage delete failed (${res.status}): ${errText}`);
    }
  },
  list: async (bucket, prefix, limit = 100, offset = 0) => {
    const creds = readSupabaseCredentials();
    const url = `${creds.url}/storage/v1/object/list/${bucket}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.serviceRoleKey}`,
        apikey: creds.serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix, limit, offset }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ArtworkStorageError(`Supabase Storage list failed (${res.status}): ${errText}`);
    }
    return (await res.json()) as Array<{ name: string; id: string }>;
  },
};

export class SupabaseArtworkObjectStore implements ArtworkObjectStore {
  readonly bucket: string;

  constructor(
    private readonly credentials: SupabaseStorageCredentials = readSupabaseCredentials(),
    private readonly operations: SupabaseStorageOperations = defaultOperations,
    bucket = process.env.SUPABASE_ARTWORK_BUCKET?.trim() || DEFAULT_SUPABASE_ARTWORK_BUCKET,
  ) {
    this.bucket = bucket;
  }

  async putPending(input: {
    userSessionId: string;
    bytes: Uint8Array;
    metadata: ArtworkMetadata;
    expiresAt: Date;
  }): Promise<PendingArtworkBinding> {
    assertMetadataMatchesBytes(input.bytes, input.metadata);
    if (!Number.isFinite(input.expiresAt.getTime()) || input.expiresAt.getTime() <= Date.now()) {
      throw new ArtworkStorageError("Pending artwork expiry must be in the future.");
    }
    const sessionScope = createHash("sha256").update(input.userSessionId, "utf8").digest("hex").slice(0, 24);
    const pendingKey = `${PENDING_ARTWORK_PREFIX}/${input.expiresAt.getTime()}/${sessionScope}/${randomUUID()}.png`;
    await this.operations.put(this.bucket, pendingKey, input.bytes, { upsert: false });
    return { ...input.metadata, pendingKey, expiresAt: input.expiresAt.toISOString() };
  }

  async readPending(binding: PendingArtworkBinding): Promise<Uint8Array | null> {
    assertPendingArtworkStorageKey(binding.pendingKey);
    const bytes = await this.operations.get(this.bucket, binding.pendingKey);
    if (!bytes) return null;
    assertMetadataMatchesBytes(bytes, binding);
    return bytes;
  }

  async promotePending(binding: PendingArtworkBinding): Promise<PromotedArtwork> {
    const bytes = await this.readPending(binding);
    if (!bytes) throw new ArtworkStorageError("Prepared artwork is unavailable or expired.");
    return this.putVerifiedFinal(bytes, binding);
  }

  async putVerifiedFinal(bytes: Uint8Array, metadata: ArtworkMetadata): Promise<PromotedArtwork> {
    assertMetadataMatchesBytes(bytes, metadata);
    const storageKey = finalArtworkStorageKey(metadata.sha256);
    const existing = await this.operations.head(this.bucket, storageKey);
    if (existing && existing.size === metadata.byteLength) {
      return { ...metadataOf(metadata), storageKey, created: false };
    }
    let created = true;
    try {
      await this.operations.put(this.bucket, storageKey, bytes, { upsert: true });
    } catch (error) {
      const raced = await this.operations.head(this.bucket, storageKey);
      if (!raced) throw error;
      created = false;
    }
    return { ...metadataOf(metadata), storageKey, created };
  }

  async readFinal(storageKey: string): Promise<Uint8Array | null> {
    assertFinalArtworkStorageKey(storageKey);
    const bytes = await this.operations.get(this.bucket, storageKey);
    if (!bytes) return null;
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_ARTWORK_OBJECT_BYTES) {
      throw new ArtworkStorageError("Artwork storage byte length is invalid.");
    }
    return bytes;
  }

  async deletePending(pendingKey: string): Promise<void> {
    assertPendingArtworkStorageKey(pendingKey);
    await this.operations.delete(this.bucket, [pendingKey]);
  }

  async deleteFinal(storageKey: string): Promise<void> {
    assertFinalArtworkStorageKey(storageKey);
    await this.operations.delete(this.bucket, [storageKey]);
  }

  async statFinal(storageKey: string): Promise<boolean> {
    assertFinalArtworkStorageKey(storageKey);
    const meta = await this.operations.head(this.bucket, storageKey);
    return !!(meta && meta.size > 0 && meta.size <= MAX_ARTWORK_OBJECT_BYTES);
  }

  async cleanupExpiredPending(options: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_CLEANUP_LIMIT, 250));
    const expired: string[] = [];
    let offset = 0;
    let scanned = 0;
    while (scanned < MAX_CLEANUP_SCAN && expired.length < limit) {
      const page = await this.operations.list(this.bucket, `${PENDING_ARTWORK_PREFIX}/`, 100, offset);
      if (!page || page.length === 0) break;
      for (const item of page) {
        scanned += 1;
        const expiry = pendingExpiry(item.name);
        if (expiry !== null && expiry <= now.getTime()) {
          expired.push(item.name);
        }
        if (expired.length >= limit || scanned >= MAX_CLEANUP_SCAN) break;
      }
      offset += page.length;
    }
    if (expired.length > 0) {
      await this.operations.delete(this.bucket, expired);
    }
    return expired.length;
  }
}

export function readSupabaseCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseStorageCredentials {
  let url = env.DATABASE_SUPABASE_URL?.trim() || env.NEXT_PUBLIC_DATABASE_SUPABASE_URL?.trim();
  if (url && !url.startsWith("http://") && !url.startsWith("https://")) {
    url = `https://${url}`;
  }
  const serviceRoleKey =
    env.DATABASE_SUPABASE_SERVICE_ROLE_KEY?.trim() || env.DATABASE_SUPABASE_SECRET_KEY?.trim();

  if (!url || !serviceRoleKey || url === "[SENSITIVE]" || serviceRoleKey === "[SENSITIVE]") {
    throw new ArtworkStorageError("Supabase artwork storage credentials are not configured.");
  }
  return { url: url.replace(/\/+$/, ""), serviceRoleKey };
}

function pendingExpiry(pathname: string): number | null {
  const match = new RegExp(`^${PENDING_ARTWORK_PREFIX}/(\\d{13})/`).exec(pathname);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

function metadataOf(value: ArtworkMetadata): ArtworkMetadata {
  return {
    sha256: value.sha256,
    mediaType: value.mediaType,
    byteLength: value.byteLength,
    width: value.width,
    height: value.height,
  };
}