import {
  CreatorIdentityKind,
  FavoriteCreatorProvenance,
  SourcePlatform,
  Prisma,
  type PrismaClient,
} from "../../../generated/prisma/client";
import type { AuthorIdentity } from "../authors/identity";
import { normalizeCreatorName } from "../authors/identity";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_IDENTITY_LENGTH = 200;

export class FavoriteCreatorValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FavoriteCreatorValidationError";
  }
}

export interface FavoriteCreatorRecord {
  identity: AuthorIdentity;
  createdAt: string;
  provenance: Array<"MANUAL" | "DATACAT">;
}

export interface FavoriteCreatorPage {
  items: FavoriteCreatorRecord[];
  nextCursor: string | null;
}

export function parseFavoriteCreatorIdentity(input: {
  platform?: unknown;
  identityKind?: unknown;
  identityValue?: unknown;
}): AuthorIdentity {
  if (typeof input.platform !== "string" || !Object.values(SourcePlatform).includes(input.platform as SourcePlatform)) {
    throw new FavoriteCreatorValidationError("A valid creator platform is required.");
  }
  if (input.identityKind !== CreatorIdentityKind.EXTERNAL_ID && input.identityKind !== CreatorIdentityKind.CREATOR_NAME) {
    throw new FavoriteCreatorValidationError("A valid creator identity kind is required.");
  }
  if (typeof input.identityValue !== "string") {
    throw new FavoriteCreatorValidationError("A creator identity value is required.");
  }
  const value = input.identityKind === CreatorIdentityKind.CREATOR_NAME
    ? normalizeCreatorName(input.identityValue)
    : input.identityValue.trim();
  if (!value || value.length > MAX_IDENTITY_LENGTH || /\p{Cc}/u.test(value)) {
    throw new FavoriteCreatorValidationError("The creator identity value is invalid.");
  }
  return {
    platform: input.platform as AuthorIdentity["platform"],
    kind: input.identityKind,
    value,
  } as AuthorIdentity;
}

export async function listFavoriteCreators(
  userId: string,
  options: { cursor?: string; limit?: number; client?: PrismaClient } = {},
): Promise<FavoriteCreatorPage> {
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const limit = normalizeLimit(options.limit);
  const cursor = options.cursor?.trim();
  if (cursor && (cursor.length > 128 || !/^[A-Za-z0-9_-]+$/u.test(cursor))) {
    throw new FavoriteCreatorValidationError("The cursor is invalid.");
  }
  const rows = await database.userFavoriteCreator.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      platform: true,
      identityKind: true,
      identityValue: true,
      createdAt: true,
      claims: { orderBy: { provenance: "asc" }, select: { provenance: true } },
    },
  });
  const visible = rows.slice(0, limit);
  return {
    items: visible.map((row) => ({
      identity: { platform: row.platform, kind: row.identityKind, value: row.identityValue } as AuthorIdentity,
      createdAt: row.createdAt.toISOString(),
      provenance: row.claims.map(({ provenance }) => provenance),
    })),
    nextCursor: rows.length > limit ? visible.at(-1)?.id ?? null : null,
  };
}

export async function setManualFavoriteCreator(
  userId: string,
  identity: AuthorIdentity,
  present: boolean,
  client?: PrismaClient,
): Promise<{ present: boolean; provenance: Array<"MANUAL" | "DATACAT"> }> {
  return setFavoriteCreatorClaim(userId, identity, FavoriteCreatorProvenance.MANUAL, present, client);
}

export async function setFavoriteCreatorClaim(
  userId: string,
  identity: AuthorIdentity,
  provenance: FavoriteCreatorProvenance,
  present: boolean,
  client?: PrismaClient,
): Promise<{ present: boolean; provenance: Array<"MANUAL" | "DATACAT"> }> {
  const normalizedIdentity = parseFavoriteCreatorIdentity({
    platform: identity.platform,
    identityKind: identity.kind,
    identityValue: identity.value,
  });
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$transaction(async (tx) => {
    const key = {
      userId_platform_identityKind_identityValue: {
        userId,
        platform: normalizedIdentity.platform,
        identityKind: normalizedIdentity.kind,
        identityValue: normalizedIdentity.value,
      },
    };
    if (present) {
      const favorite = await tx.userFavoriteCreator.upsert({
        where: key,
        update: {},
        create: {
          userId,
          platform: normalizedIdentity.platform,
          identityKind: normalizedIdentity.kind,
          identityValue: normalizedIdentity.value,
        },
        select: { id: true },
      });
      await tx.userFavoriteCreatorClaim.upsert({
        where: { favoriteCreatorId_provenance: { favoriteCreatorId: favorite.id, provenance } },
        update: {},
        create: { favoriteCreatorId: favorite.id, provenance },
      });
    } else {
      const favorite = await tx.userFavoriteCreator.findUnique({ where: key, select: { id: true } });
      if (favorite) {
        await tx.userFavoriteCreatorClaim.deleteMany({ where: { favoriteCreatorId: favorite.id, provenance } });
        await tx.userFavoriteCreator.deleteMany({
          where: { id: favorite.id, claims: { none: {} } },
        });
      }
    }
    const favorite = await tx.userFavoriteCreator.findUnique({
      where: key,
      select: { claims: { orderBy: { provenance: "asc" }, select: { provenance: true } } },
    });
    return {
      present: Boolean(favorite),
      provenance: favorite?.claims.map(({ provenance: source }) => source) ?? [],
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new FavoriteCreatorValidationError(`Limit must be between 1 and ${MAX_LIMIT}.`);
  }
  return value;
}
