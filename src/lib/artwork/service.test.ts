import { describe, expect, it, vi } from "vitest";
import type { ArtworkObjectStore, PromotedArtwork } from "./types";
import { cleanupUnreferencedFinalArtwork } from "./service";

const promoted: PromotedArtwork = {
  sha256: "a".repeat(64),
  mediaType: "image/png",
  byteLength: 4,
  width: 1,
  height: 1,
  storageKey: `artwork/sha256/${"a".repeat(64)}.png`,
  created: true,
};

describe("final artwork compensation", () => {
  it("deletes only a newly created final object with no durable database identity", async () => {
    const store = objectStore();
    const client = { artworkAsset: { count: vi.fn(async () => 0) } };
    await expect(cleanupUnreferencedFinalArtwork(promoted, client as never, store)).resolves.toBe(true);
    expect(store.deleteFinal).toHaveBeenCalledWith(promoted.storageKey);
  });

  it("never deletes a final object represented by a durable ArtworkAsset", async () => {
    const store = objectStore();
    const client = { artworkAsset: { count: vi.fn(async () => 1) } };
    await expect(cleanupUnreferencedFinalArtwork(promoted, client as never, store)).resolves.toBe(false);
    expect(store.deleteFinal).not.toHaveBeenCalled();
  });

  it("does not delete an object that predated the failed promotion attempt", async () => {
    const store = objectStore();
    const client = { artworkAsset: { count: vi.fn() } };
    await expect(cleanupUnreferencedFinalArtwork({ ...promoted, created: false }, client as never, store)).resolves.toBe(false);
    expect(client.artworkAsset.count).not.toHaveBeenCalled();
    expect(store.deleteFinal).not.toHaveBeenCalled();
  });
});

function objectStore(): ArtworkObjectStore & { deleteFinal: ReturnType<typeof vi.fn> } {
  return {
    putPending: vi.fn(),
    readPending: vi.fn(),
    promotePending: vi.fn(),
    readFinal: vi.fn(),
    deletePending: vi.fn(),
    deleteFinal: vi.fn(async () => undefined),
    statFinal: vi.fn(),
    cleanupExpiredPending: vi.fn(),
  } as unknown as ArtworkObjectStore & { deleteFinal: ReturnType<typeof vi.fn> };
}
