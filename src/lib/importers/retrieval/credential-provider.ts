import type { SourcePlatformIdentity } from "./types";
import { decryptSecret, encryptSecret } from "./encryption";
import type { SourcePlatform } from "@/generated/prisma/client";

export class InvalidSourceCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSourceCredentialError";
  }
}

export interface ConnectionStatusResult {
  connected: boolean;
  platform: SourcePlatformIdentity;
  expiresAt: Date | null;
  updatedAt: Date | null;
}

export interface SourceCredentialProvider {
  getAuthorizationHeader(platform: SourcePlatformIdentity): Promise<string | null>;
  setCredential(
    platform: SourcePlatformIdentity,
    token: string,
    expiresAt?: Date | null,
  ): Promise<void>;
  revokeCredential(platform: SourcePlatformIdentity): Promise<void>;
  getConnectionStatus(platform: SourcePlatformIdentity): Promise<ConnectionStatusResult>;
}

export interface StoredSourceConnection {
  id: string;
  platform: SourcePlatform;
  encryptedToken: string;
  iv: string;
  authTag: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SourceConnectionClient {
  sourceConnection: {
    findUnique(args: {
      where: { platform: SourcePlatform };
      select?: { platform?: boolean; expiresAt?: boolean; updatedAt?: boolean };
    }): Promise<StoredSourceConnection | { platform: SourcePlatform; expiresAt: Date | null; updatedAt: Date } | null>;
    upsert(args: {
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
    }): Promise<StoredSourceConnection>;
    deleteMany(args: { where: { platform: SourcePlatform } }): Promise<{ count: number }>;
  };
}

const MAX_TOKEN_LENGTH = 4096;
const INVALID_TOKEN_CHARS = /[\r\n\t\0]/;
const TOKEN_WHITESPACE = /\s/;
const QUOTED_TOKEN = /^(?:".*"|'.*')$/;

export function normalizeAndValidateToken(rawToken: unknown): string {
  if (typeof rawToken !== "string") {
    throw new InvalidSourceCredentialError("Token must be a valid string.");
  }

  // Reject control characters before trimming so an outer newline cannot be
  // silently normalized into a valid HTTP header value.
  if (INVALID_TOKEN_CHARS.test(rawToken)) {
    throw new InvalidSourceCredentialError("Token contains invalid control characters.");
  }

  let token = rawToken.trim();
  if (/^bearer(?: +|$)/i.test(token)) {
    token = token.replace(/^bearer(?: +|$)/i, "").trim();
  }

  if (token.length === 0 || token.toLowerCase() === "bearer") {
    throw new InvalidSourceCredentialError("Token cannot be empty.");
  }

  if (token.length > MAX_TOKEN_LENGTH) {
    throw new InvalidSourceCredentialError("Token exceeds maximum supported length.");
  }

  if (TOKEN_WHITESPACE.test(token) || QUOTED_TOKEN.test(token)) {
    throw new InvalidSourceCredentialError("Token must be an unquoted value without whitespace.");
  }

  return token;
}

function toPrismaPlatform(platform: SourcePlatformIdentity): SourcePlatform {
  if (platform === "JANITOR_AI") return "JANITOR_AI";
  if (platform === "SAUCEPAN") return "SAUCEPAN";
  if (platform === "DATACAT") return "DATACAT";
  throw new InvalidSourceCredentialError(`Platform "${platform}" does not support persistent connections.`);
}

export class DatabaseSourceCredentialProvider implements SourceCredentialProvider {
  private readonly clientOverride?: SourceConnectionClient;

  constructor(clientOverride?: SourceConnectionClient) {
    this.clientOverride = clientOverride;
  }

  private async getPrisma(): Promise<SourceConnectionClient> {
    if (this.clientOverride) {
      if (!this.clientOverride.sourceConnection) {
        throw new Error("Prisma client does not have sourceConnection delegate initialized.");
      }
      return this.clientOverride;
    }
    const { prisma } = await import("../../../../lib/prisma");
    if (!prisma?.sourceConnection) {
      throw new Error("Prisma client does not have sourceConnection delegate initialized.");
    }
    return prisma as unknown as SourceConnectionClient;
  }

  async getAuthorizationHeader(platform: SourcePlatformIdentity): Promise<string | null> {
    const prismaPlatform = toPrismaPlatform(platform);
    const prisma = await this.getPrisma();

    const record = (await prisma.sourceConnection.findUnique({
      where: { platform: prismaPlatform },
    })) as StoredSourceConnection | null;

    if (!record) return null;

    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      return null;
    }

    // Revalidate after decryption as well, so legacy stored values cannot
    // produce a doubled Bearer scheme or an invalid header.
    const token = normalizeAndValidateToken(
      decryptSecret(record.encryptedToken, record.iv, record.authTag),
    );
    return `Bearer ${token}`;
  }

  async setCredential(
    platform: SourcePlatformIdentity,
    rawToken: string,
    expiresAt?: Date | null,
  ): Promise<void> {
    const prismaPlatform = toPrismaPlatform(platform);
    const token = normalizeAndValidateToken(rawToken);
    const { encryptedToken, iv, authTag } = encryptSecret(token);
    const prisma = await this.getPrisma();

    await prisma.sourceConnection.upsert({
      where: { platform: prismaPlatform },
      create: {
        platform: prismaPlatform,
        encryptedToken,
        iv,
        authTag,
        expiresAt: expiresAt ?? null,
      },
      update: {
        encryptedToken,
        iv,
        authTag,
        expiresAt: expiresAt ?? null,
      },
    });
  }

  async revokeCredential(platform: SourcePlatformIdentity): Promise<void> {
    const prismaPlatform = toPrismaPlatform(platform);
    const prisma = await this.getPrisma();

    await prisma.sourceConnection.deleteMany({
      where: { platform: prismaPlatform },
    });
  }

  async getConnectionStatus(platform: SourcePlatformIdentity): Promise<ConnectionStatusResult> {
    try {
      const prismaPlatform = toPrismaPlatform(platform);
      const prisma = await this.getPrisma();

      const record = await prisma.sourceConnection.findUnique({
        where: { platform: prismaPlatform },
        select: {
          platform: true,
          expiresAt: true,
          updatedAt: true,
        },
      });

      if (!record) {
        return {
          connected: false,
          platform,
          expiresAt: null,
          updatedAt: null,
        };
      }

      const isExpired = Boolean(record.expiresAt && record.expiresAt.getTime() <= Date.now());
      return {
        connected: !isExpired,
        platform,
        expiresAt: record.expiresAt,
        updatedAt: record.updatedAt,
      };
    } catch {
      return {
        connected: false,
        platform,
        expiresAt: null,
        updatedAt: null,
      };
    }
  }
}

export const defaultCredentialProvider: SourceCredentialProvider =
  new DatabaseSourceCredentialProvider();
