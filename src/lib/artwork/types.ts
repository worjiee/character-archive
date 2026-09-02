export const ARTWORK_MEDIA_TYPE = "image/png" as const;
export const PENDING_ARTWORK_TTL_MS = 24 * 60 * 60 * 1_000;
export const ARTWORK_SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface ArtworkMetadata {
  sha256: string;
  mediaType: typeof ARTWORK_MEDIA_TYPE;
  byteLength: number;
  width: number;
  height: number;
}

export interface PendingArtworkBinding extends ArtworkMetadata {
  pendingKey: string;
  expiresAt: string;
}

export interface PromotedArtwork extends ArtworkMetadata {
  storageKey: string;
  created: boolean;
}

export interface ArtworkObjectStore {
  putPending(input: {
    userSessionId: string;
    bytes: Uint8Array;
    metadata: ArtworkMetadata;
    expiresAt: Date;
  }): Promise<PendingArtworkBinding>;
  readPending(binding: PendingArtworkBinding): Promise<Uint8Array | null>;
  promotePending(binding: PendingArtworkBinding): Promise<PromotedArtwork>;
  readFinal(storageKey: string): Promise<Uint8Array | null>;
  deletePending(pendingKey: string): Promise<void>;
  deleteFinal(storageKey: string): Promise<void>;
  statFinal(storageKey: string): Promise<boolean>;
  cleanupExpiredPending(options?: { now?: Date; limit?: number }): Promise<number>;
}

export interface SafeArtworkPreview {
  available: true;
  url: string;
  sha256: string;
  mediaType: typeof ARTWORK_MEDIA_TYPE;
  byteLength: number;
  width: number;
  height: number;
}
