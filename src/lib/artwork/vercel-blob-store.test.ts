import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ArtworkStorageError, finalArtworkStorageKey } from "./local-store";
import { readVercelBlobCredentials, VercelBlobArtworkObjectStore, type VercelBlobOperations } from "./vercel-blob-store";

class MemoryBlobOperations implements VercelBlobOperations {
  readonly objects = new Map<string, Uint8Array>();
  readonly options: Record<string, unknown>[] = [];

  async put(pathname: string, bytes: Uint8Array, options: Record<string, unknown>) {
    this.options.push(options);
    if (this.objects.has(pathname) && options.allowOverwrite !== true) throw new Error("already exists");
    this.objects.set(pathname, new Uint8Array(bytes));
    return { pathname, size: bytes.byteLength, contentType: "image/png" };
  }

  async get(pathname: string) {
    const bytes = this.objects.get(pathname);
    if (!bytes) return null;
    return {
      statusCode: 200 as const,
      stream: streamOf(bytes),
      blob: { pathname, size: bytes.byteLength, contentType: "image/png" },
    };
  }

  async head(pathname: string) {
    const bytes = this.objects.get(pathname);
    if (!bytes) {
      const error = new Error("missing");
      error.name = "BlobNotFoundError";
      throw error;
    }
    return { pathname, size: bytes.byteLength, contentType: "image/png" };
  }

  async list(options: Record<string, unknown>) {
    const prefix = String(options.prefix ?? "");
    const blobs = [...this.objects.entries()]
      .filter(([pathname]) => pathname.startsWith(prefix))
      .map(([pathname, bytes]) => ({ pathname, size: bytes.byteLength }));
    return { blobs, hasMore: false };
  }

  async del(pathname: string | string[]) {
    for (const key of Array.isArray(pathname) ? pathname : [pathname]) this.objects.delete(key);
  }
}

describe("Vercel Blob artwork object-store provider", () => {
  it("fails closed without its private server token", () => {
    expect(() => readVercelBlobCredentials({})).toThrow(ArtworkStorageError);
    expect(() => readVercelBlobCredentials({ BLOB_READ_WRITE_TOKEN: "[SENSITIVE]" })).toThrow(ArtworkStorageError);
  });

  it("accepts either a private read/write token or an ephemeral OIDC/store pair", () => {
    expect(readVercelBlobCredentials({ BLOB_READ_WRITE_TOKEN: "token" })).toEqual({ token: "token" });
    expect(readVercelBlobCredentials({ VERCEL_OIDC_TOKEN: "oidc", BLOB_STORE_ID: "store" })).toEqual({
      oidcToken: "oidc",
      storeId: "store",
    });
  });

  it("uses private exact-path objects, verifies bytes, and deduplicates final artwork", async () => {
    const operations = new MemoryBlobOperations();
    const store = new VercelBlobArtworkObjectStore({ token: "test-token" }, operations);
    const bytes = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3);
    const metadata = metadataFor(bytes);
    const first = await store.putPending({
      userSessionId: "session-a",
      bytes,
      metadata,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(first.pendingKey).not.toContain("session-a");
    await expect(store.readPending(first)).resolves.toEqual(bytes);
    await expect(store.promotePending(first)).resolves.toEqual({
      ...metadata,
      storageKey: finalArtworkStorageKey(metadata.sha256),
      created: true,
    });
    await expect(store.statFinal(finalArtworkStorageKey(metadata.sha256))).resolves.toBe(true);

    await expect(store.putVerifiedFinal(bytes, metadata)).resolves.toMatchObject({ created: false });

    const second = await store.putPending({
      userSessionId: "session-b",
      bytes,
      metadata,
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(store.promotePending(second)).resolves.toMatchObject({ created: false });
    expect(operations.options.every((options) => options.access === "private" && options.addRandomSuffix === false)).toBe(true);
    expect(operations.options.every((options) => options.maximumSizeInBytes === 33_554_432)).toBe(true);
  });

  it("rejects tampered pending objects and bounded oversized reads", async () => {
    const operations = new MemoryBlobOperations();
    const store = new VercelBlobArtworkObjectStore({ token: "test-token" }, operations);
    const bytes = Uint8Array.of(1, 2, 3, 4);
    const binding = await store.putPending({
      userSessionId: "session-a",
      bytes,
      metadata: metadataFor(bytes),
      expiresAt: new Date(Date.now() + 60_000),
    });
    operations.objects.set(binding.pendingKey, Uint8Array.of(4, 3, 2, 1));
    await expect(store.readPending(binding)).rejects.toBeInstanceOf(ArtworkStorageError);

    const key = finalArtworkStorageKey(binding.sha256);
    operations.objects.set(key, new Uint8Array(33_554_433));
    await expect(store.readFinal(key)).rejects.toBeInstanceOf(ArtworkStorageError);
  });

  it("cleans only expired pending objects up to the per-run limit", async () => {
    const operations = new MemoryBlobOperations();
    const store = new VercelBlobArtworkObjectStore({ token: "test-token" }, operations);
    const bytes = Uint8Array.of(1);
    const metadata = metadataFor(bytes);
    const future = new Date(Date.now() + 60_000);
    const bindings = await Promise.all(Array.from({ length: 3 }, (_, index) =>
      store.putPending({ userSessionId: `session-${index}`, bytes, metadata, expiresAt: future })));

    await expect(store.cleanupExpiredPending({ now: new Date(future.getTime() + 1), limit: 2 })).resolves.toBe(2);
    expect(bindings.filter(({ pendingKey }) => operations.objects.has(pendingKey))).toHaveLength(1);
  });
});

function metadataFor(bytes: Uint8Array) {
  return {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    mediaType: "image/png" as const,
    byteLength: bytes.byteLength,
    width: 1,
    height: 1,
  };
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}
