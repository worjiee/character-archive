import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, link, mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ARTWORK_SHA256_PATTERN,
  type ArtworkMetadata,
  type ArtworkObjectStore,
  type PendingArtworkBinding,
  type PromotedArtwork,
} from "./types";

export const PENDING_ARTWORK_PREFIX = "pending-artwork";
export const FINAL_ARTWORK_PREFIX = "artwork/sha256";
const DEFAULT_CLEANUP_LIMIT = 50;
const MAX_CLEANUP_DIRECTORY_SCAN = 1_000;

export class LocalArtworkObjectStore implements ArtworkObjectStore {
  readonly root: string;

  constructor(root = path.resolve(process.cwd(), ".var", "artwork")) {
    this.root = path.resolve(root);
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
    const target = this.resolveKey(pendingKey, "pending");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.bytes, { flag: "wx" });
    return { ...input.metadata, pendingKey, expiresAt: input.expiresAt.toISOString() };
  }

  async readPending(binding: PendingArtworkBinding): Promise<Uint8Array | null> {
    const target = this.resolveKey(binding.pendingKey, "pending");
    try {
      const bytes = new Uint8Array(await readFile(target));
      assertMetadataMatchesBytes(bytes, binding);
      return bytes;
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async promotePending(binding: PendingArtworkBinding): Promise<PromotedArtwork> {
    const bytes = await this.readPending(binding);
    if (!bytes) throw new ArtworkStorageError("Prepared artwork is unavailable or expired.");
    const storageKey = finalArtworkStorageKey(binding.sha256);
    const target = this.resolveKey(storageKey, "final");
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { flag: "wx" });
    let created = false;
    try {
      try {
        await link(temporary, target);
        created = true;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
    } finally {
      await rm(temporary, { force: true });
    }
    const finalBytes = new Uint8Array(await readFile(target));
    assertMetadataMatchesBytes(finalBytes, binding);
    return { ...metadataOf(binding), storageKey, created };
  }

  async readFinal(storageKey: string): Promise<Uint8Array | null> {
    const target = this.resolveKey(storageKey, "final");
    try {
      return new Uint8Array(await readFile(target));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async deletePending(pendingKey: string): Promise<void> {
    await rm(this.resolveKey(pendingKey, "pending"), { force: true });
  }

  async deleteFinal(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey, "final"), { force: true });
  }

  async statFinal(storageKey: string): Promise<boolean> {
    try {
      await access(this.resolveKey(storageKey, "final"), constants.R_OK);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async cleanupExpiredPending(options: { now?: Date; limit?: number } = {}): Promise<number> {
    const now = options.now ?? new Date();
    const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_CLEANUP_LIMIT, 250));
    const pendingRoot = this.resolveKey(PENDING_ARTWORK_PREFIX, "pending-root");
    let expiryDirectories: string[];
    try {
      expiryDirectories = (await readdir(pendingRoot)).slice(0, MAX_CLEANUP_DIRECTORY_SCAN);
    } catch (error) {
      if (isMissing(error)) return 0;
      throw error;
    }
    let deleted = 0;
    for (const expiry of expiryDirectories.sort((left, right) => Number(left) - Number(right))) {
      if (!/^\d{13}$/.test(expiry) || Number(expiry) > now.getTime()) continue;
      const expiryRoot = path.join(pendingRoot, expiry);
      const sessionDirectories = (await readdir(expiryRoot)).slice(0, MAX_CLEANUP_DIRECTORY_SCAN);
      for (const sessionDirectory of sessionDirectories) {
        const sessionRoot = path.join(expiryRoot, sessionDirectory);
        const files = (await readdir(sessionRoot)).slice(0, limit - deleted);
        for (const filename of files) {
          await rm(path.join(sessionRoot, filename), { force: true });
          deleted += 1;
          if (deleted >= limit) return deleted;
        }
        await removeIfEmpty(sessionRoot);
      }
      await removeIfEmpty(expiryRoot);
    }
    return deleted;
  }

  private resolveKey(key: string, kind: "pending" | "pending-root" | "final"): string {
    if (kind === "pending-root" && key === PENDING_ARTWORK_PREFIX) return path.join(this.root, PENDING_ARTWORK_PREFIX);
    if (key.includes("\\") || key.includes("\0") || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new ArtworkStorageError("Artwork storage key is invalid.");
    }
    if (kind === "pending") assertPendingArtworkStorageKey(key);
    if (kind === "final") assertFinalArtworkStorageKey(key);
    const resolved = path.resolve(this.root, ...key.split("/"));
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new ArtworkStorageError("Artwork storage path escapes its configured root.");
    return resolved;
  }
}

export class ArtworkStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtworkStorageError";
  }
}

export function finalArtworkStorageKey(sha256: string): string {
  if (!ARTWORK_SHA256_PATTERN.test(sha256)) throw new ArtworkStorageError("Artwork SHA-256 is invalid.");
  return `${FINAL_ARTWORK_PREFIX}/${sha256}.png`;
}

export function assertPendingArtworkStorageKey(key: string): void {
  if (key.includes("\\") || key.includes("\0") || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ArtworkStorageError("Artwork storage key is invalid.");
  }
  if (!new RegExp(`^${PENDING_ARTWORK_PREFIX}/\\d{13}/[0-9a-f]{24}/[0-9a-f-]{36}\\.png$`).test(key)) {
    throw new ArtworkStorageError("Pending artwork key is invalid.");
  }
}

export function assertFinalArtworkStorageKey(key: string): void {
  if (key.includes("\\") || key.includes("\0") || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new ArtworkStorageError("Artwork storage key is invalid.");
  }
  if (!new RegExp(`^${FINAL_ARTWORK_PREFIX}/[0-9a-f]{64}\\.png$`).test(key)) {
    throw new ArtworkStorageError("Final artwork key is invalid.");
  }
}

export function assertMetadataMatchesBytes(bytes: Uint8Array, metadata: ArtworkMetadata): void {
  if (!ARTWORK_SHA256_PATTERN.test(metadata.sha256) || metadata.mediaType !== "image/png" || metadata.byteLength !== bytes.byteLength) {
    throw new ArtworkStorageError("Artwork metadata does not match the prepared bytes.");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== metadata.sha256) throw new ArtworkStorageError("Artwork digest verification failed.");
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

async function removeIfEmpty(directory: string): Promise<void> {
  try {
    if ((await readdir(directory)).length === 0) await rmdir(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST";
}
