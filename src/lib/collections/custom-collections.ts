import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { visibleCharacterWhere } from "../auth/authorization";
import type { AuthenticatedPrincipal } from "../auth/session";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";
import type { CharacterCardItem } from "../characters/browse";
import {
  COLLECTION_CHARACTER_SELECT,
  toCharacterCardItem,
} from "../characters/collections";

export const MAX_COLLECTIONS_PER_USER = 50;
export const COLLECTION_NAME_MIN_LENGTH = 1;
export const COLLECTION_NAME_MAX_LENGTH = 50;
export const COLLECTION_DESCRIPTION_MAX_LENGTH = 300;
export const RESERVED_COLLECTION_NAMES = new Set([
  "favorites",
  "cart",
  "all",
  "characters",
]);

export class CustomCollectionValidationError extends Error {}
export class CustomCollectionNotFoundError extends Error {}
export class CustomCollectionLimitError extends Error {}
export class CustomCollectionConflictError extends Error {}

export interface UserCollectionItem {
  id: string;
  name: string;
  description: string | null;
  characterCount: number;
  recentArtworkThumbnails: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserCollectionDetail {
  id: string;
  name: string;
  description: string | null;
  characterCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserCollectionCharacterBrowseInput {
  query?: string;
  sort?: "added" | "freshest" | "name";
  page?: number;
  limit?: number;
}

export interface UserCollectionCharacterBrowseResult {
  collection: UserCollectionDetail;
  items: CharacterCardItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface CharacterCollectionMembership {
  collectionId: string;
  collectionName: string;
  isMember: boolean;
}

export interface CreateUserCollectionInput {
  name: string;
  description?: string | null;
}

export interface UpdateUserCollectionInput {
  name?: string;
  description?: string | null;
}

export function normalizeCollectionName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateCollectionName(raw: unknown): { name: string; normalizedName: string } {
  if (typeof raw !== "string") {
    throw new CustomCollectionValidationError("Collection name must be a string.");
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < COLLECTION_NAME_MIN_LENGTH || name.length > COLLECTION_NAME_MAX_LENGTH) {
    throw new CustomCollectionValidationError(
      `Collection name must be between ${COLLECTION_NAME_MIN_LENGTH} and ${COLLECTION_NAME_MAX_LENGTH} characters.`
    );
  }
  const normalizedName = normalizeCollectionName(name);
  if (RESERVED_COLLECTION_NAMES.has(normalizedName)) {
    throw new CustomCollectionValidationError(`"${name}" is a reserved collection name.`);
  }
  return { name, normalizedName };
}

export function validateCollectionDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") {
    throw new CustomCollectionValidationError("Collection description must be a string.");
  }
  const description = raw.trim();
  if (description.length === 0) return null;
  if (description.length > COLLECTION_DESCRIPTION_MAX_LENGTH) {
    throw new CustomCollectionValidationError(
      `Collection description cannot exceed ${COLLECTION_DESCRIPTION_MAX_LENGTH} characters.`
    );
  }
  return description;
}

export async function listUserCollections(
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<UserCollectionItem[]> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const visibleWhere = visibleCharacterWhere(principal);

  const collections = await database.characterCollection.findMany({
    where: { ownerUserId: principal.userId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          items: {
            where: { character: visibleWhere },
          },
        },
      },
      items: {
        where: { character: visibleWhere },
        orderBy: { addedAt: "desc" },
        take: 4,
        select: {
          character: {
            select: {
              id: true,
              name: true,
              nameOverride: true,
              avatarUrl: true,
              avatarUrlOverride: true,
              artworkSha256: true,
            },
          },
        },
      },
    },
  });

  return collections.map((col) => ({
    id: col.id,
    name: col.name,
    description: col.description,
    characterCount: col._count.items,
    recentArtworkThumbnails: col.items
      .map((item) => resolveCharacterArtworkUrl(item.character))
      .filter((url): url is string => Boolean(url)),
    createdAt: col.createdAt.toISOString(),
    updatedAt: col.updatedAt.toISOString(),
  }));
}

export async function createUserCollection(
  principal: AuthenticatedPrincipal,
  input: CreateUserCollectionInput,
  client?: PrismaClient,
): Promise<UserCollectionDetail> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const { name, normalizedName } = validateCollectionName(input.name);
  const description = validateCollectionDescription(input.description);

  const currentCount = await database.characterCollection.count({
    where: { ownerUserId: principal.userId },
  });
  if (currentCount >= MAX_COLLECTIONS_PER_USER) {
    throw new CustomCollectionLimitError(
      `You have reached the maximum limit of ${MAX_COLLECTIONS_PER_USER} collections.`
    );
  }

  const existing = await database.characterCollection.findUnique({
    where: {
      ownerUserId_normalizedName: {
        ownerUserId: principal.userId,
        normalizedName,
      },
    },
  });
  if (existing) {
    throw new CustomCollectionConflictError(`A collection named "${name}" already exists.`);
  }

  const created = await database.characterCollection.create({
    data: {
      ownerUserId: principal.userId,
      name,
      normalizedName,
      description,
    },
  });

  return {
    id: created.id,
    name: created.name,
    description: created.description,
    characterCount: 0,
    createdAt: created.createdAt.toISOString(),
    updatedAt: created.updatedAt.toISOString(),
  };
}

export async function getUserCollection(
  principal: AuthenticatedPrincipal,
  collectionId: string,
  client?: PrismaClient,
): Promise<UserCollectionDetail> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const visibleWhere = visibleCharacterWhere(principal);

  const col = await database.characterCollection.findFirst({
    where: {
      id: collectionId,
      ownerUserId: principal.userId,
    },
    include: {
      _count: {
        select: {
          items: {
            where: { character: visibleWhere },
          },
        },
      },
    },
  });

  if (!col) {
    throw new CustomCollectionNotFoundError("Collection not found.");
  }

  return {
    id: col.id,
    name: col.name,
    description: col.description,
    characterCount: col._count.items,
    createdAt: col.createdAt.toISOString(),
    updatedAt: col.updatedAt.toISOString(),
  };
}

export async function updateUserCollection(
  principal: AuthenticatedPrincipal,
  collectionId: string,
  input: UpdateUserCollectionInput,
  client?: PrismaClient,
): Promise<UserCollectionDetail> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const existing = await database.characterCollection.findFirst({
    where: {
      id: collectionId,
      ownerUserId: principal.userId,
    },
  });

  if (!existing) {
    throw new CustomCollectionNotFoundError("Collection not found.");
  }

  const data: Prisma.CharacterCollectionUpdateInput = {};

  if (input.name !== undefined) {
    const { name, normalizedName } = validateCollectionName(input.name);
    if (normalizedName !== existing.normalizedName) {
      const collision = await database.characterCollection.findUnique({
        where: {
          ownerUserId_normalizedName: {
            ownerUserId: principal.userId,
            normalizedName,
          },
        },
      });
      if (collision) {
        throw new CustomCollectionConflictError(`A collection named "${name}" already exists.`);
      }
    }
    data.name = name;
    data.normalizedName = normalizedName;
  }

  if (input.description !== undefined) {
    data.description = validateCollectionDescription(input.description);
  }

  const updated = await database.characterCollection.update({
    where: { id: collectionId },
    data,
    include: {
      _count: {
        select: {
          items: {
            where: { character: visibleCharacterWhere(principal) },
          },
        },
      },
    },
  });

  return {
    id: updated.id,
    name: updated.name,
    description: updated.description,
    characterCount: updated._count.items,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function deleteUserCollection(
  principal: AuthenticatedPrincipal,
  collectionId: string,
  client?: PrismaClient,
): Promise<{ success: boolean }> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const existing = await database.characterCollection.findFirst({
    where: {
      id: collectionId,
      ownerUserId: principal.userId,
    },
  });

  if (!existing) {
    throw new CustomCollectionNotFoundError("Collection not found.");
  }

  await database.characterCollection.delete({
    where: { id: collectionId },
  });

  return { success: true };
}

export async function browseUserCollectionCharacters(
  principal: AuthenticatedPrincipal,
  collectionId: string,
  input: UserCollectionCharacterBrowseInput = {},
  client?: PrismaClient,
): Promise<UserCollectionCharacterBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const collection = await getUserCollection(principal, collectionId, database);

  const query = input.query?.trim() ?? "";
  const sort = input.sort ?? "added";
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(100, Math.max(1, input.limit ?? 50));
  const skip = (page - 1) * limit;

  const characterWhere: Prisma.CharacterWhereInput = {
    ...visibleCharacterWhere(principal),
    ...(query
      ? {
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { nameOverride: { contains: query, mode: "insensitive" } },
            { sources: { some: { creatorName: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const itemWhere: Prisma.CharacterCollectionItemWhereInput = {
    collectionId,
    character: characterWhere,
  };

  let orderBy: Prisma.CharacterCollectionItemOrderByWithRelationInput[];
  if (sort === "freshest") {
    orderBy = [
      { character: { publishedAt: "desc" } },
      { character: { createdAt: "desc" } },
      { addedAt: "desc" },
    ];
  } else if (sort === "name") {
    orderBy = [{ character: { name: "asc" } }, { addedAt: "desc" }];
  } else {
    orderBy = [{ addedAt: "desc" }, { characterId: "asc" }];
  }

  const [records, total] = await Promise.all([
    database.characterCollectionItem.findMany({
      where: itemWhere,
      orderBy,
      skip,
      take: limit,
      select: {
        character: {
          select: COLLECTION_CHARACTER_SELECT,
        },
      },
    }),
    database.characterCollectionItem.count({ where: itemWhere }),
  ]);

  return {
    collection,
    items: records.map(({ character }) => toCharacterCardItem(character)),
    total,
    page,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getCharacterCollectionMemberships(
  principal: AuthenticatedPrincipal,
  characterId: string,
  client?: PrismaClient,
): Promise<CharacterCollectionMembership[]> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;

  const [collections, memberItems] = await Promise.all([
    database.characterCollection.findMany({
      where: { ownerUserId: principal.userId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    database.characterCollectionItem.findMany({
      where: {
        characterId,
        collection: { ownerUserId: principal.userId },
      },
      select: { collectionId: true },
    }),
  ]);

  const memberSet = new Set(memberItems.map((item) => item.collectionId));

  return collections.map((col) => ({
    collectionId: col.id,
    collectionName: col.name,
    isMember: memberSet.has(col.id),
  }));
}

export async function setCharacterCollectionItem(
  principal: AuthenticatedPrincipal,
  collectionId: string,
  characterId: string,
  present: boolean,
  client?: PrismaClient,
): Promise<{ collectionId: string; characterId: string; present: boolean; count: number }> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;

  const collection = await database.characterCollection.findFirst({
    where: {
      id: collectionId,
      ownerUserId: principal.userId,
    },
  });

  if (!collection) {
    throw new CustomCollectionNotFoundError("Collection not found.");
  }

  if (present) {
    const character = await database.character.findFirst({
      where: {
        AND: [{ id: characterId }, visibleCharacterWhere(principal)],
      },
      select: { id: true },
    });
    if (!character) {
      throw new CustomCollectionNotFoundError("Character not found.");
    }

    await database.$transaction([
      database.characterCollectionItem.upsert({
        where: {
          collectionId_characterId: { collectionId, characterId },
        },
        update: {},
        create: { collectionId, characterId },
      }),
      database.characterCollection.update({
        where: { id: collectionId },
        data: { updatedAt: new Date() },
      }),
    ]);
  } else {
    await database.$transaction([
      database.characterCollectionItem.deleteMany({
        where: { collectionId, characterId },
      }),
      database.characterCollection.update({
        where: { id: collectionId },
        data: { updatedAt: new Date() },
      }),
    ]);
  }

  const count = await database.characterCollectionItem.count({
    where: {
      collectionId,
      character: visibleCharacterWhere(principal),
    },
  });

  return { collectionId, characterId, present, count };
}
