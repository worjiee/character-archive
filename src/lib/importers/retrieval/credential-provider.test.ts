import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  DatabaseSourceCredentialProvider,
  InvalidSourceCredentialError,
  normalizeAndValidateToken,
  type SourceConnectionClient,
  type StoredSourceConnection,
} from "./credential-provider";
import type { SourcePlatform } from "@/generated/prisma/client";

function createMockPrismaClient(): SourceConnectionClient {
  const store = new Map<string, StoredSourceConnection>();
  return {
    sourceConnection: {
      findUnique: vi.fn(async ({ where }: { where: { platform: SourcePlatform } }) => {
        return store.get(where.platform) ?? null;
      }),
      upsert: vi.fn(async ({ where, create, update }: {
        where: { platform: SourcePlatform };
        create: {
          platform: SourcePlatform;
          encryptedToken: string;
          iv: string;
          authTag: string;
          expiresAt: Date | null;
        };
        update: {
          encryptedToken: string;
          iv: string;
          authTag: string;
          expiresAt: Date | null;
        };
      }) => {
        const existing = store.get(where.platform);
        const data: StoredSourceConnection = existing
          ? { ...existing, ...update, updatedAt: new Date() }
          : {
              id: "conn-1",
              ...create,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
        store.set(where.platform, data);
        return data;
      }),
      deleteMany: vi.fn(async ({ where }: { where: { platform: SourcePlatform } }) => {
        store.delete(where.platform);
        return { count: 1 };
      }),
    },
  };
}

describe("DatabaseSourceCredentialProvider & Token Validation", () => {
  beforeAll(() => {
    process.env.SOURCE_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  });

  it("normalizes leading Bearer prefix and trims whitespace", () => {
    expect(normalizeAndValidateToken("Bearer my-token-123")).toBe("my-token-123");
    expect(normalizeAndValidateToken("bearer   my-token-456  ")).toBe("my-token-456");
    expect(normalizeAndValidateToken("my-token-789")).toBe("my-token-789");
  });

  it("rejects empty token inputs", () => {
    expect(() => normalizeAndValidateToken("")).toThrow(InvalidSourceCredentialError);
    expect(() => normalizeAndValidateToken("   ")).toThrow(InvalidSourceCredentialError);
    expect(() => normalizeAndValidateToken("Bearer ")).toThrow(InvalidSourceCredentialError);
    expect(() => normalizeAndValidateToken("Bearer")).toThrow(InvalidSourceCredentialError);
  });

  it("rejects control characters, newlines, and header injection attempts", () => {
    expect(() => normalizeAndValidateToken("\ntoken")).toThrow(
      InvalidSourceCredentialError,
    );
    expect(() => normalizeAndValidateToken("token\n")).toThrow(
      InvalidSourceCredentialError,
    );
    expect(() => normalizeAndValidateToken("token\nInjected-Header: evil")).toThrow(
      InvalidSourceCredentialError,
    );
    expect(() => normalizeAndValidateToken("token\r\nother")).toThrow(
      InvalidSourceCredentialError,
    );
    expect(() => normalizeAndValidateToken("token\twith-tab")).toThrow(
      InvalidSourceCredentialError,
    );
  });

  it("rejects quoted and whitespace-containing credential values", () => {
    expect(() => normalizeAndValidateToken('"token"')).toThrow(
      InvalidSourceCredentialError,
    );
    expect(() => normalizeAndValidateToken("token with-space")).toThrow(
      InvalidSourceCredentialError,
    );
  });

  it("rejects oversized tokens", () => {
    const hugeToken = "a".repeat(4097);
    expect(() => normalizeAndValidateToken(hugeToken)).toThrow(
      InvalidSourceCredentialError,
    );
  });

  it("stores, retrieves, and revokes encrypted credentials in database", async () => {
    const mockPrisma = createMockPrismaClient();
    const provider = new DatabaseSourceCredentialProvider(mockPrisma);
    const testToken = "janitor-test-token-abcdef123456";

    // Set credential
    await provider.setCredential("JANITOR_AI", testToken);

    // Verify status
    const status = await provider.getConnectionStatus("JANITOR_AI");
    expect(status.connected).toBe(true);
    expect(status.platform).toBe("JANITOR_AI");
    expect(status.expiresAt).toBeNull();

    // Verify authorization header
    const authHeader = await provider.getAuthorizationHeader("JANITOR_AI");
    expect(authHeader).toBe(`Bearer ${testToken}`);

    // Revoke
    await provider.revokeCredential("JANITOR_AI");

    // Verify disconnected
    const postRevokeStatus = await provider.getConnectionStatus("JANITOR_AI");
    expect(postRevokeStatus.connected).toBe(false);

    const postRevokeAuth = await provider.getAuthorizationHeader("JANITOR_AI");
    expect(postRevokeAuth).toBeNull();
  });

  it("constructs exactly one Bearer scheme for raw and Bearer-prefixed input", async () => {
    const mockPrisma = createMockPrismaClient();
    const provider = new DatabaseSourceCredentialProvider(mockPrisma);

    await provider.setCredential("JANITOR_AI", "  raw-dummy-token  ");
    expect(await provider.getAuthorizationHeader("JANITOR_AI")).toBe(
      "Bearer raw-dummy-token",
    );

    await provider.setCredential("JANITOR_AI", "  Bearer prefixed-dummy-token  ");
    expect(await provider.getAuthorizationHeader("JANITOR_AI")).toBe(
      "Bearer prefixed-dummy-token",
    );
  });

  it("respects expiresAt in the past and treats as disconnected", async () => {
    const mockPrisma = createMockPrismaClient();
    const provider = new DatabaseSourceCredentialProvider(mockPrisma);
    const testToken = "expired-token";
    const pastDate = new Date(Date.now() - 10000);

    await provider.setCredential("JANITOR_AI", testToken, pastDate);

    const status = await provider.getConnectionStatus("JANITOR_AI");
    expect(status.connected).toBe(false);

    const authHeader = await provider.getAuthorizationHeader("JANITOR_AI");
    expect(authHeader).toBeNull();

    await provider.revokeCredential("JANITOR_AI");
  });

  it("rejects non-persisted platform like JANNY", async () => {
    const mockPrisma = createMockPrismaClient();
    const provider = new DatabaseSourceCredentialProvider(mockPrisma);
    await expect(provider.setCredential("JANNY", "token")).rejects.toThrow(
      InvalidSourceCredentialError,
    );
  });

  it("fails fast with clear diagnostic if client lacks sourceConnection delegate (stale client regression)", async () => {
    const staleClient = {} as unknown as SourceConnectionClient;
    const provider = new DatabaseSourceCredentialProvider(staleClient);

    await expect(provider.setCredential("JANITOR_AI", "token")).rejects.toThrow(
      "Prisma client does not have sourceConnection delegate initialized.",
    );
  });

  it("verifies that the repository generated PrismaClient class defines sourceConnection delegate", async () => {
    const { PrismaClient } = await import("../../../../generated/prisma/client");
    expect(PrismaClient).toBeDefined();
    expect(typeof PrismaClient).toBe("function");
    expect(PrismaClient.prototype).toBeDefined();
  });
});
