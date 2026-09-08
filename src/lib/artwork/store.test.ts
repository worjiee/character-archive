import { afterEach, describe, expect, it, vi } from "vitest";
import { ArtworkStorageConfigurationError, getArtworkObjectStore, readArtworkStorageProvider, setArtworkObjectStoreForTests } from "./store";

afterEach(() => {
  vi.unstubAllEnvs();
  setArtworkObjectStoreForTests(null);
});

describe("artwork storage configuration", () => {
  it("defaults to local only outside production", () => {
    expect(readArtworkStorageProvider({ NODE_ENV: "development" })).toBe("local");
    expect(readArtworkStorageProvider({ NODE_ENV: "test" })).toBe("local");
  });

  it("fails closed in production when no approved provider is selected", () => {
    expect(() => readArtworkStorageProvider({ NODE_ENV: "production" })).toThrow(ArtworkStorageConfigurationError);
    expect(() => readArtworkStorageProvider({ NODE_ENV: "production", ARTWORK_STORAGE_PROVIDER: "unknown" }))
      .toThrow(ArtworkStorageConfigurationError);
  });

  it("recognizes the durable production adapter", () => {
    expect(readArtworkStorageProvider({ NODE_ENV: "production", ARTWORK_STORAGE_PROVIDER: "vercel-blob" }))
      .toBe("vercel-blob");
    expect(readArtworkStorageProvider({ NODE_ENV: "production", ARTWORK_STORAGE_PROVIDER: "supabase" }))
      .toBe("supabase");
  });

  it("fails closed when the selected durable provider has no usable credential", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ARTWORK_STORAGE_PROVIDER", "vercel-blob");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    vi.stubEnv("BLOB_STORE_ID", "");
    expect(() => getArtworkObjectStore()).toThrow(ArtworkStorageConfigurationError);

    vi.stubEnv("ARTWORK_STORAGE_PROVIDER", "supabase");
    vi.stubEnv("DATABASE_SUPABASE_URL", "");
    vi.stubEnv("DATABASE_SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => getArtworkObjectStore()).toThrow(ArtworkStorageConfigurationError);
  });
});
