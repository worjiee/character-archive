import type { ArtworkObjectStore } from "./types";
import { LocalArtworkObjectStore } from "./local-store";
import { VercelBlobArtworkObjectStore } from "./vercel-blob-store";
import { SupabaseArtworkObjectStore } from "./supabase-store";

export type ArtworkStorageProvider = "local" | "vercel-blob" | "supabase";

let configuredStore: ArtworkObjectStore | null = null;

export function getArtworkObjectStore(): ArtworkObjectStore {
  if (configuredStore) return configuredStore;
  const provider = readArtworkStorageProvider();
  if (provider === "local") {
    if (process.env.NODE_ENV === "production") {
      throw new ArtworkStorageConfigurationError("The local artwork provider is development-only and cannot run in production.");
    }
    configuredStore = new LocalArtworkObjectStore(process.env.ARTWORK_LOCAL_ROOT?.trim() || undefined);
    return configuredStore;
  }
  if (provider === "supabase") {
    try {
      configuredStore = new SupabaseArtworkObjectStore();
      return configuredStore;
    } catch {
      throw new ArtworkStorageConfigurationError("Private Supabase artwork storage is unavailable.");
    }
  }
  try {
    configuredStore = new VercelBlobArtworkObjectStore();
    return configuredStore;
  } catch {
    throw new ArtworkStorageConfigurationError("Private artwork storage is unavailable.");
  }
}

export function readArtworkStorageProvider(env: NodeJS.ProcessEnv = process.env): ArtworkStorageProvider {
  const configured = env.ARTWORK_STORAGE_PROVIDER?.trim().toLowerCase();
  if (!configured && env.NODE_ENV !== "production") return "local";
  if (configured === "local" || configured === "vercel-blob" || configured === "supabase") return configured;
  if (!configured) {
    throw new ArtworkStorageConfigurationError("ARTWORK_STORAGE_PROVIDER must select an approved durable provider in production.");
  }
  throw new ArtworkStorageConfigurationError(`Unknown ARTWORK_STORAGE_PROVIDER: ${configured}`);
}

export function setArtworkObjectStoreForTests(store: ArtworkObjectStore | null): void {
  configuredStore = store;
}

export class ArtworkStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtworkStorageConfigurationError";
  }
}
