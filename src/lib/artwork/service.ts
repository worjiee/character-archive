import type { PrismaClient } from "../../../generated/prisma/client";
import { getArtworkObjectStore } from "./store";
import type {
  ArtworkMetadata,
  ArtworkObjectStore,
  PendingArtworkBinding,
  PromotedArtwork,
  SafeArtworkPreview,
} from "./types";
import { PENDING_ARTWORK_TTL_MS } from "./types";
import { ArtworkStorageError, assertMetadataMatchesBytes } from "./local-store";

import { prepareCanonicalLosslessArtwork } from "./optimizer";

export async function preparePendingArtwork(
  userSessionId: string,
  bytes: Uint8Array,
  metadata: ArtworkMetadata,
  options: { store?: ArtworkObjectStore; now?: Date } = {},
): Promise<PendingArtworkBinding> {
  assertMetadataMatchesBytes(bytes, metadata);
  let payloadBytes = bytes;
  let payloadMetadata = metadata;
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) {
    const canonical = await prepareCanonicalLosslessArtwork(bytes);
    payloadBytes = canonical.bytes;
    payloadMetadata = canonical.metadata;
    assertMetadataMatchesBytes(payloadBytes, payloadMetadata);
  }
  const now = options.now ?? new Date();
  return (options.store ?? getArtworkObjectStore()).putPending({
    userSessionId,
    bytes: payloadBytes,
    metadata: payloadMetadata,
    expiresAt: new Date(now.getTime() + PENDING_ARTWORK_TTL_MS),
  });
}

export async function verifyAndPromotePendingArtwork(
  binding: PendingArtworkBinding,
  options: { store?: ArtworkObjectStore; now?: Date } = {},
): Promise<PromotedArtwork> {
  const now = options.now ?? new Date();
  if (!Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= now.getTime()) {
    throw new PendingArtworkError("PREPARED_ARTWORK_EXPIRED", "Prepared artwork expired. Upload the artifact again.");
  }
  const store = options.store ?? getArtworkObjectStore();
  let bytes: Uint8Array | null;
  try {
    bytes = await store.readPending(binding);
  } catch (error) {
    if (error instanceof ArtworkStorageError) {
      throw new PendingArtworkError("PREPARED_ARTWORK_INVALID", "Prepared artwork failed integrity verification.");
    }
    throw error;
  }
  if (!bytes) throw new PendingArtworkError("PREPARED_ARTWORK_MISSING", "Prepared artwork is unavailable. Upload the artifact again.");
  try {
    assertMetadataMatchesBytes(bytes, binding);
  } catch {
    throw new PendingArtworkError("PREPARED_ARTWORK_INVALID", "Prepared artwork failed integrity verification.");
  }
  try {
    return await store.promotePending(binding);
  } catch (error) {
    if (error instanceof ArtworkStorageError) {
      throw new PendingArtworkError("PREPARED_ARTWORK_INVALID", "Prepared artwork failed integrity verification.");
    }
    throw error;
  }
}

export async function readPreparedArtwork(
  binding: PendingArtworkBinding,
  options: { store?: ArtworkObjectStore; now?: Date } = {},
): Promise<Uint8Array | null> {
  if (Date.parse(binding.expiresAt) <= (options.now ?? new Date()).getTime()) return null;
  return (options.store ?? getArtworkObjectStore()).readPending(binding);
}

export async function cleanupUnreferencedFinalArtwork(
  promoted: PromotedArtwork,
  client: PrismaClient,
  store: ArtworkObjectStore = getArtworkObjectStore(),
): Promise<boolean> {
  if (!promoted.created) return false;
  const referenced = await client.artworkAsset.count({ where: { sha256: promoted.sha256 } });
  if (referenced > 0) return false;
  await store.deleteFinal(promoted.storageKey);
  return true;
}

export function safeArtworkPreview(binding: PendingArtworkBinding, url: string): SafeArtworkPreview {
  return {
    available: true,
    url,
    sha256: binding.sha256,
    mediaType: binding.mediaType,
    byteLength: binding.byteLength,
    width: binding.width,
    height: binding.height,
  };
}

export class PendingArtworkError extends Error {
  readonly status = 422;
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PendingArtworkError";
  }
}
