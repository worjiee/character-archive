import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalArtworkObjectStore, ArtworkStorageError, finalArtworkStorageKey } from "./local-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local artwork object-store provider", () => {
  it("prepares, reads, atomically promotes, deduplicates, and preserves exact bytes", async () => {
    const store = await localStore();
    const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4);
    const metadata = metadataFor(bytes);
    const expiresAt = new Date(Date.now() + 60_000);

    const first = await store.putPending({ userSessionId: "session-a", bytes, metadata, expiresAt });
    expect(first.pendingKey).not.toContain("session-a");
    await expect(store.readPending(first)).resolves.toEqual(bytes);

    const promoted = await store.promotePending(first);
    expect(promoted).toMatchObject({
      ...metadata,
      storageKey: finalArtworkStorageKey(metadata.sha256),
      created: true,
    });
    await expect(store.readFinal(promoted.storageKey)).resolves.toEqual(bytes);
    expect(await readFile(path.join(store.root, ...promoted.storageKey.split("/")))).toEqual(Buffer.from(bytes));

    const second = await store.putPending({ userSessionId: "session-b", bytes, metadata, expiresAt });
    await expect(store.promotePending(second)).resolves.toMatchObject({ storageKey: promoted.storageKey, created: false });
    await store.deletePending(first.pendingKey);
    await expect(store.readPending(first)).resolves.toBeNull();
  });

  it("fails integrity verification when pending bytes are changed after preview", async () => {
    const store = await localStore();
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const binding = await store.putPending({
      userSessionId: "session-a",
      bytes,
      metadata: metadataFor(bytes),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await writeFile(path.join(store.root, ...binding.pendingKey.split("/")), Uint8Array.of(4, 3, 2, 1));

    await expect(store.readPending(binding)).rejects.toBeInstanceOf(ArtworkStorageError);
    await expect(store.promotePending(binding)).rejects.toBeInstanceOf(ArtworkStorageError);
    await expect(store.statFinal(finalArtworkStorageKey(binding.sha256))).resolves.toBe(false);
  });

  it("cleans expired pending objects with a strict per-run bound", async () => {
    const store = await localStore();
    const bytes = Uint8Array.of(9);
    const metadata = metadataFor(bytes);
    const future = new Date(Date.now() + 60_000);
    const bindings = await Promise.all(Array.from({ length: 3 }, (_, index) =>
      store.putPending({ userSessionId: `session-${index}`, bytes, metadata, expiresAt: future })));
    const afterExpiry = new Date(future.getTime() + 1);

    await expect(store.cleanupExpiredPending({ now: afterExpiry, limit: 2 })).resolves.toBe(2);
    const remaining = await Promise.all(bindings.map((binding) => store.readPending(binding).then(Boolean)));
    expect(remaining.filter(Boolean)).toHaveLength(1);
    await expect(store.cleanupExpiredPending({ now: afterExpiry, limit: 2 })).resolves.toBe(1);
  });

  it("rejects invalid and path-shaped storage keys", async () => {
    const store = await localStore();
    await expect(store.readFinal("../outside.png")).rejects.toBeInstanceOf(ArtworkStorageError);
    expect(() => finalArtworkStorageKey("not-a-digest")).toThrow(ArtworkStorageError);
  });
});

async function localStore(): Promise<LocalArtworkObjectStore> {
  const root = await mkdtemp(path.join(os.tmpdir(), "chikpeas-artwork-"));
  roots.push(root);
  return new LocalArtworkObjectStore(root);
}

function metadataFor(bytes: Uint8Array) {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "image/png" as const,
    byteLength: bytes.byteLength,
    width: 1,
    height: 1,
  };
}
