import { createHash, randomUUID } from "node:crypto";
import { del, get, head, list, put } from "@vercel/blob";
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

interface BlobMetadata {
  pathname: string;
  size: number;
  contentType?: string;
}

interface BlobGetResult {
  statusCode: 200 | 304;
  stream: ReadableStream<Uint8Array> | null;
  blob: BlobMetadata;
}

interface BlobListResult {
  blobs: Array<{ pathname: string; size: number }>;
  cursor?: string;
  hasMore: boolean;
}

export interface VercelBlobOperations {
  put(pathname: string, bytes: Uint8Array, options: Record<string, unknown>): Promise<{ pathname: string }>;
  get(pathname: string, options: Record<string, unknown>): Promise<BlobGetResult | null>;
  head(pathname: string, options: Record<string, unknown>): Promise<BlobMetadata>;
  list(options: Record<string, unknown>): Promise<BlobListResult>;
  del(pathname: string | string[], options: Record<string, unknown>): Promise<void>;
}

export type VercelBlobCredentials =
  | { token: string }
  | { oidcToken: string; storeId: string };

const defaultOperations: VercelBlobOperations = {
  put: async (pathname, bytes, options) => {
    const result = await put(pathname, Buffer.from(bytes), options as unknown as Parameters<typeof put>[2]);
    return { pathname: result.pathname };
  },
  get: (pathname, options) => get(pathname, options as unknown as Parameters<typeof get>[1]) as unknown as Promise<BlobGetResult | null>,
  head: (pathname, options) => head(pathname, options) as Promise<BlobMetadata>,
  list: (options) => list(options) as Promise<BlobListResult>,
  del: (pathname, options) => del(pathname, options),
};

export class VercelBlobArtworkObjectStore implements ArtworkObjectStore {
  constructor(
    private readonly credentials: VercelBlobCredentials = readVercelBlobCredentials(),
    private readonly operations: VercelBlobOperations = defaultOperations,
  ) {}

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
    await this.operations.put(pendingKey, input.bytes, this.writeOptions(false, 60));
    return { ...input.metadata, pendingKey, expiresAt: input.expiresAt.toISOString() };
  }

  async readPending(binding: PendingArtworkBinding): Promise<Uint8Array | null> {
    assertPendingArtworkStorageKey(binding.pendingKey);
    const bytes = await this.read(binding.pendingKey, false);
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
    const existing = await this.readFinal(storageKey);
    if (existing) {
      assertMetadataMatchesBytes(existing, metadata);
      return { ...metadataOf(metadata), storageKey, created: false };
    }
    let created = true;
    try {
      await this.operations.put(storageKey, bytes, this.writeOptions(false, 31_536_000));
    } catch (error) {
      const raced = await this.readFinal(storageKey);
      if (!raced) throw error;
      assertMetadataMatchesBytes(raced, metadata);
      created = false;
    }
    const persisted = await this.readFinal(storageKey);
    if (!persisted) throw new ArtworkStorageError("Durable artwork could not be verified after upload.");
    assertMetadataMatchesBytes(persisted, metadata);
    return { ...metadataOf(metadata), storageKey, created };
  }

  async readFinal(storageKey: string): Promise<Uint8Array | null> {
    assertFinalArtworkStorageKey(storageKey);
    return this.read(storageKey, true);
  }

  async deletePending(pendingKey: string): Promise<void> {
    assertPendingArtworkStorageKey(pendingKey);
    await this.operations.del(pendingKey, this.credentials);
  }

  async deleteFinal(storageKey: string): Promise<void> {
    assertFinalArtworkStorageKey(storageKey);
    await this.operations.del(storageKey, this.credentials);
  }

  async statFinal(storageKey: string): Promise<boolean> {
    assertFinalArtworkStorageKey(storageKey);
    try {
      const metadata = await this.operations.head(storageKey, this.credentials);
      return metadata.pathname === storageKey && metadata.size > 0 && metadata.size <= MAX_ARTWORK_OBJECT_BYTES;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async cleanupExpiredPending(options: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_CLEANUP_LIMIT, 250));
    const expired: string[] = [];
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const page = await this.operations.list({
        ...this.credentials,
        prefix: `${PENDING_ARTWORK_PREFIX}/`,
        limit: Math.min(250, MAX_CLEANUP_SCAN - scanned),
        ...(cursor ? { cursor } : {}),
      });
      for (const blob of page.blobs) {
        scanned += 1;
        const expiry = pendingExpiry(blob.pathname);
        if (expiry !== null && expiry <= now.getTime()) expired.push(blob.pathname);
        if (expired.length >= limit || scanned >= MAX_CLEANUP_SCAN) break;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor && expired.length < limit && scanned < MAX_CLEANUP_SCAN);
    if (expired.length > 0) await this.operations.del(expired, this.credentials);
    return expired.length;
  }

  private async read(pathname: string, useCache: boolean): Promise<Uint8Array | null> {
    const result = await this.operations.get(pathname, {
      access: "private",
      ...this.credentials,
      useCache,
    });
    if (!result) return null;
    if (result.statusCode !== 200 || !result.stream) throw new ArtworkStorageError("Artwork storage returned an unexpected response.");
    if (result.blob.pathname !== pathname || result.blob.size <= 0 || result.blob.size > MAX_ARTWORK_OBJECT_BYTES) {
      throw new ArtworkStorageError("Artwork storage metadata is invalid.");
    }
    if (result.blob.contentType && result.blob.contentType.toLowerCase() !== "image/png") {
      throw new ArtworkStorageError("Artwork storage returned an unexpected media type.");
    }
    return readBoundedStream(result.stream, result.blob.size);
  }

  private writeOptions(allowOverwrite: boolean, cacheControlMaxAge: number): Record<string, unknown> {
    return {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite,
      cacheControlMaxAge,
      contentType: "image/png",
      maximumSizeInBytes: MAX_ARTWORK_OBJECT_BYTES,
      ...this.credentials,
    };
  }
}

export function readVercelBlobCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): VercelBlobCredentials {
  const token = env.BLOB_READ_WRITE_TOKEN?.trim();
  if (token && token !== "[SENSITIVE]") return { token };
  const oidcToken = env.VERCEL_OIDC_TOKEN?.trim();
  const storeId = env.BLOB_STORE_ID?.trim();
  if (oidcToken && storeId && oidcToken !== "[SENSITIVE]" && storeId !== "[SENSITIVE]") return { oidcToken, storeId };
  throw new ArtworkStorageError("Private artwork storage is not configured.");
}

async function readBoundedStream(stream: ReadableStream<Uint8Array>, expectedSize: number): Promise<Uint8Array> {
  const output = new Uint8Array(expectedSize);
  const reader = stream.getReader();
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > output.byteLength) throw new ArtworkStorageError("Artwork storage byte length is invalid.");
      output.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== expectedSize) throw new ArtworkStorageError("Artwork storage byte length is invalid.");
  return output;
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

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "BlobNotFoundError";
}
