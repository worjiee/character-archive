import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ArtworkStorageError, finalArtworkStorageKey } from "./local-store";
import {
  readSupabaseCredentials,
  SupabaseArtworkObjectStore,
  type SupabaseStorageOperations,
} from "./supabase-store";

class MemorySupabaseOperations implements SupabaseStorageOperations {
  readonly objects = new Map<string, Uint8Array>();

  async get(bucket: string, pathname: string): Promise<Uint8Array | null> {
    const bytes = this.objects.get(`${bucket}/${pathname}`);
    return bytes ? new Uint8Array(bytes) : null;
  }

  async put(bucket: string, pathname: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(`${bucket}/${pathname}`, new Uint8Array(bytes));
  }

  async head(bucket: string, pathname: string): Promise<{ size: number } | null> {
    const bytes = this.objects.get(`${bucket}/${pathname}`);
    return bytes ? { size: bytes.byteLength } : null;
  }

  async delete(bucket: string, pathnames: string[]): Promise<void> {
    for (const p of pathnames) {
      this.objects.delete(`${bucket}/${p}`);
    }
  }

  async list(bucket: string, prefix: string): Promise<Array<{ name: string; id: string }>> {
    const prefixKey = `${bucket}/${prefix}`;
    const results: Array<{ name: string; id: string }> = [];
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefixKey)) {
        const name = key.slice(`${bucket}/`.length);
        results.push({ name, id: name });
      }
    }
    return results;
  }
}

describe("Supabase artwork object-store provider", () => {
  it("fails closed without server-side credentials", () => {
    expect(() => readSupabaseCredentials({})).toThrow(ArtworkStorageError);
    expect(() =>
      readSupabaseCredentials({
        DATABASE_SUPABASE_URL: "https://example.supabase.co",
        DATABASE_SUPABASE_SERVICE_ROLE_KEY: "[SENSITIVE]",
      }),
    ).toThrow(ArtworkStorageError);
  });

  it("reads credentials correctly from DATABASE_SUPABASE_URL and SERVICE_ROLE_KEY", () => {
    const creds = readSupabaseCredentials({
      DATABASE_SUPABASE_URL: "https://test.supabase.co",
      DATABASE_SUPABASE_SERVICE_ROLE_KEY: "service-key-123",
    });
    expect(creds).toEqual({
      url: "https://test.supabase.co",
      serviceRoleKey: "service-key-123",
    });
  });

  it("stores, promotes, reads, and deletes final artwork objects", () => {
    const memory = new MemorySupabaseOperations();
    const store = new SupabaseArtworkObjectStore(
      { url: "https://test.supabase.co", serviceRoleKey: "key" },
      memory,
      "character-archive-artwork",
    );

    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const metadata = {
      sha256,
      mediaType: "image/png" as const,
      byteLength: bytes.byteLength,
      width: 100,
      height: 100,
    };

    return (async () => {
      const promoted = await store.putVerifiedFinal(bytes, metadata);
      expect(promoted.storageKey).toBe(finalArtworkStorageKey(sha256));
      expect(promoted.created).toBe(true);

      const exists = await store.statFinal(promoted.storageKey);
      expect(exists).toBe(true);

      const retrieved = await store.readFinal(promoted.storageKey);
      expect(retrieved).not.toBeNull();
      expect(retrieved).toEqual(bytes);

      await store.deleteFinal(promoted.storageKey);
      const afterDelete = await store.statFinal(promoted.storageKey);
      expect(afterDelete).toBe(false);
    })();
  });
});