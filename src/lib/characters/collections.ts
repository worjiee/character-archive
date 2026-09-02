import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere } from "../auth/authorization";
import type { AuthenticatedPrincipal } from "../auth/session";
import type { CharacterCardItem } from "./browse";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export const CHARACTER_COLLECTION_KINDS = ["favorites", "cart"] as const;
export const CHARACTER_COLLECTION_BULK_LIMIT = 100;
export const CHARACTER_COLLECTION_VIEW_LIMIT = 100;
export const CHARACTER_COLLECTION_SORTS = ["freshest", "saved"] as const;

export type CharacterCollectionKind = (typeof CHARACTER_COLLECTION_KINDS)[number];
export type CharacterCollectionSort = (typeof CHARACTER_COLLECTION_SORTS)[number];

export interface CharacterCollectionState {
  favoriteIds: string[];
  cartIds: string[];
}

export interface CharacterCollectionMutationResult {
  collection: CharacterCollectionKind;
  characterId: string;
  present: boolean;
  count: number;
}

export interface CharacterCartBulkResult {
  added: number;
  count: number;
  characterIds: string[];
}

export interface CharacterCollectionBrowseInput {
  query: string;
  sort: CharacterCollectionSort;
}

export interface CharacterCollectionBrowseResult {
  items: CharacterCardItem[];
  total: number;
  limited: boolean;
}

const COLLECTION_CHARACTER_SELECT = {
  id: true,
  name: true,
  nameOverride: true,
  avatarUrl: true,
  avatarUrlOverride: true,
  artworkSha256: true,
  status: true,
  sources: {
    orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
    select: { platform: true, creatorName: true, externalCreatorId: true },
  },
  tags: {
    orderBy: { tag: { name: "asc" } },
    select: { tag: { select: { name: true, slug: true } } },
  },
} satisfies Prisma.CharacterSelect;

export class CharacterCollectionValidationError extends Error {}
export class CharacterCollectionNotFoundError extends Error {}

export function parseCharacterCollectionKind(value: string): CharacterCollectionKind {
  if ((CHARACTER_COLLECTION_KINDS as readonly string[]).includes(value)) {
    return value as CharacterCollectionKind;
  }
  throw new CharacterCollectionValidationError("Unknown character collection.");
}

export function parseCharacterCollectionPresence(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new CharacterCollectionValidationError("present must be a boolean.");
  }
  return value;
}

export function assertCharacterCollectionInputKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new CharacterCollectionValidationError("Request contains an unexpected field.");
  }
}

export function parseCharacterIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CharacterCollectionValidationError("characterIds must be a non-empty array.");
  }
  if (value.length > CHARACTER_COLLECTION_BULK_LIMIT) {
    throw new CharacterCollectionValidationError(`A maximum of ${CHARACTER_COLLECTION_BULK_LIMIT} characters may be added at once.`);
  }
  const ids = value.map((id) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new CharacterCollectionValidationError("characterIds contains an invalid Character ID.");
    }
    return id;
  });
  return [...new Set(ids)];
}

export function parseCharacterCollectionBrowseInput(
  value: Record<string, string | string[] | undefined>,
): CharacterCollectionBrowseInput {
  const rawQuery = firstSearchValue(value.q)?.trim() ?? "";
  const rawSort = firstSearchValue(value.sort);
  return {
    query: rawQuery.slice(0, 80),
    sort: rawSort === "saved" ? "saved" : "freshest",
  };
}

export async function getCharacterCollectionState(
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterCollectionState> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const visibleCharacter = visibleCharacterWhere(principal);
  const [favorites, cart] = await Promise.all([
    database.characterFavorite.findMany({
      where: { userId: principal.userId, character: visibleCharacter },
      orderBy: [{ createdAt: "desc" }, { characterId: "asc" }],
      select: { characterId: true },
    }),
    database.characterCartItem.findMany({
      where: { userId: principal.userId, character: visibleCharacter },
      orderBy: [{ createdAt: "desc" }, { characterId: "asc" }],
      select: { characterId: true },
    }),
  ]);
  return {
    favoriteIds: favorites.map(({ characterId }) => characterId),
    cartIds: cart.map(({ characterId }) => characterId),
  };
}

export async function setCharacterCollectionMembership(
  principal: AuthenticatedPrincipal,
  collection: CharacterCollectionKind,
  characterId: string,
  present: boolean,
  client?: PrismaClient,
): Promise<CharacterCollectionMutationResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(characterId)) {
    throw new CharacterCollectionValidationError("Invalid Character ID.");
  }

  if (present) {
    await database.$transaction(async (transaction) => {
      const character = await transaction.character.findFirst({
        where: { AND: [{ id: characterId }, visibleCharacterWhere(principal)] },
        select: { id: true },
      });
      if (!character) throw new CharacterCollectionNotFoundError("Character not found.");
      if (collection === "favorites") {
        await transaction.characterFavorite.upsert({
          where: { userId_characterId: { userId: principal.userId, characterId } },
          update: {},
          create: { userId: principal.userId, characterId },
          select: { characterId: true },
        });
      } else {
        await transaction.characterCartItem.upsert({
          where: { userId_characterId: { userId: principal.userId, characterId } },
          update: {},
          create: { userId: principal.userId, characterId },
          select: { characterId: true },
        });
      }
    });
  } else if (collection === "favorites") {
    await database.characterFavorite.deleteMany({ where: { userId: principal.userId, characterId } });
  } else {
    await database.characterCartItem.deleteMany({ where: { userId: principal.userId, characterId } });
  }

  return {
    collection,
    characterId,
    present,
    count: await collectionCount(principal, collection, database),
  };
}

export async function addCharactersToCart(
  principal: AuthenticatedPrincipal,
  characterIds: readonly string[],
  client?: PrismaClient,
): Promise<CharacterCartBulkResult> {
  const ids = parseCharacterIds(characterIds);
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$transaction(async (transaction) => {
    const characters = await transaction.character.findMany({
      where: { AND: [{ id: { in: ids } }, visibleCharacterWhere(principal)] },
      select: { id: true },
    });
    if (characters.length !== ids.length) {
      throw new CharacterCollectionNotFoundError("One or more selected characters are no longer available.");
    }
    const created = await transaction.characterCartItem.createMany({
      data: ids.map((characterId) => ({ userId: principal.userId, characterId })),
      skipDuplicates: true,
    });
    const count = await transaction.characterCartItem.count({
      where: { userId: principal.userId, character: visibleCharacterWhere(principal) },
    });
    return { added: created.count, count, characterIds: ids };
  });
}

export async function listCollectionCharacters(
  principal: AuthenticatedPrincipal,
  collection: CharacterCollectionKind,
  client?: PrismaClient,
): Promise<CharacterCardItem[]> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const query = {
    where: { userId: principal.userId, character: visibleCharacterWhere(principal) },
    orderBy: [{ createdAt: "desc" as const }, { characterId: "asc" as const }],
    select: { character: { select: COLLECTION_CHARACTER_SELECT } },
  };
  const records = collection === "favorites"
    ? await database.characterFavorite.findMany(query)
    : await database.characterCartItem.findMany(query);

  return records.map(({ character }) => toCharacterCardItem(character));
}

export async function browseCollectionCharacters(
  principal: AuthenticatedPrincipal,
  collection: CharacterCollectionKind,
  input: CharacterCollectionBrowseInput,
  client?: PrismaClient,
): Promise<CharacterCollectionBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const characterWhere: Prisma.CharacterWhereInput = {
    ...visibleCharacterWhere(principal),
    ...(input.query ? {
      OR: [
        { name: { contains: input.query, mode: "insensitive" } },
        { nameOverride: { contains: input.query, mode: "insensitive" } },
        { sources: { some: { creatorName: { contains: input.query, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  const where = { userId: principal.userId, character: characterWhere };

  const [records, total] = collection === "favorites"
    ? await Promise.all([
      database.characterFavorite.findMany({
        where,
        orderBy: input.sort === "saved"
          ? [{ createdAt: "desc" }, { characterId: "asc" }]
          : [{ character: { updatedAt: "desc" } }, { createdAt: "desc" }, { characterId: "asc" }],
        take: CHARACTER_COLLECTION_VIEW_LIMIT,
        select: { character: { select: COLLECTION_CHARACTER_SELECT } },
      }),
      database.characterFavorite.count({ where }),
    ])
    : await Promise.all([
      database.characterCartItem.findMany({
        where,
        orderBy: input.sort === "saved"
          ? [{ createdAt: "desc" }, { characterId: "asc" }]
          : [{ character: { updatedAt: "desc" } }, { createdAt: "desc" }, { characterId: "asc" }],
        take: CHARACTER_COLLECTION_VIEW_LIMIT,
        select: { character: { select: COLLECTION_CHARACTER_SELECT } },
      }),
      database.characterCartItem.count({ where }),
    ]);

  return {
    items: records.map(({ character }) => toCharacterCardItem(character)),
    total,
    limited: total > CHARACTER_COLLECTION_VIEW_LIMIT,
  };
}

async function collectionCount(
  principal: AuthenticatedPrincipal,
  collection: CharacterCollectionKind,
  database: PrismaClient,
): Promise<number> {
  const where = { userId: principal.userId, character: visibleCharacterWhere(principal) };
  return collection === "favorites"
    ? database.characterFavorite.count({ where })
    : database.characterCartItem.count({ where });
}

function toCharacterCardItem(character: Prisma.CharacterGetPayload<{ select: typeof COLLECTION_CHARACTER_SELECT }>): CharacterCardItem {
  return {
    id: character.id,
    name: character.nameOverride ?? character.name,
    avatarUrl: resolveCharacterArtworkUrl(character),
    status: character.status as CharacterCardItem["status"],
    sources: character.sources,
    tags: character.tags.map(({ tag }) => tag),
  };
}

function firstSearchValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
