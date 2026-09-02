import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  addCharactersToCart,
  browseCollectionCharacters,
  CHARACTER_COLLECTION_VIEW_LIMIT,
  CharacterCollectionNotFoundError,
  CharacterCollectionValidationError,
  assertCharacterCollectionInputKeys,
  getCharacterCollectionState,
  listCollectionCharacters,
  parseCharacterCollectionBrowseInput,
  parseCharacterCollectionKind,
  parseCharacterCollectionPresence,
  parseCharacterIds,
  setCharacterCollectionMembership,
} from "./collections";

describe("character collection validation", () => {
  it("accepts only real collection names and boolean membership", () => {
    expect(parseCharacterCollectionKind("favorites")).toBe("favorites");
    expect(parseCharacterCollectionKind("cart")).toBe("cart");
    expect(() => parseCharacterCollectionKind("tags")).toThrow(CharacterCollectionValidationError);
    expect(parseCharacterCollectionPresence(true)).toBe(true);
    expect(() => parseCharacterCollectionPresence("true")).toThrow(CharacterCollectionValidationError);
  });

  it("deduplicates bounded canonical Character IDs", () => {
    expect(parseCharacterIds(["character-1", "character-1", "character_2"])).toEqual(["character-1", "character_2"]);
    expect(() => parseCharacterIds([])).toThrow(CharacterCollectionValidationError);
    expect(() => parseCharacterIds(["../character"])).toThrow(CharacterCollectionValidationError);
    expect(() => parseCharacterIds(Array.from({ length: 101 }, (_, index) => `character-${index}`))).toThrow(CharacterCollectionValidationError);
  });

  it("normalizes bounded collection search and supported sorts", () => {
    expect(parseCharacterCollectionBrowseInput({ q: "  Theron  ", sort: "saved" })).toEqual({
      query: "Theron",
      sort: "saved",
    });
    expect(parseCharacterCollectionBrowseInput({ q: "x".repeat(100), sort: "unknown" })).toEqual({
      query: "x".repeat(80),
      sort: "freshest",
    });
  });

  it("rejects forged ownership and other unexpected mutation fields", () => {
    expect(() => assertCharacterCollectionInputKeys({ present: true, userId: USER_B.userId }, ["present"]))
      .toThrow(CharacterCollectionValidationError);
  });
});

describe("persistent character collections", () => {
  it("loads visible favorite and Cart IDs in deterministic collection order", async () => {
    const favoriteFindMany = vi.fn().mockResolvedValue([{ characterId: "favorite-2" }, { characterId: "favorite-1" }]);
    const cartFindMany = vi.fn().mockResolvedValue([{ characterId: "cart-1" }]);
    const result = await getCharacterCollectionState(USER_A, {
      characterFavorite: { findMany: favoriteFindMany },
      characterCartItem: { findMany: cartFindMany },
    } as unknown as PrismaClient);
    expect(result).toEqual({ favoriteIds: ["favorite-2", "favorite-1"], cartIds: ["cart-1"] });
    expect(favoriteFindMany.mock.calls[0]?.[0].where).toEqual({ userId: USER_A.userId, character: { status: { not: "DELETED" } } });
    expect(cartFindMany.mock.calls[0]?.[0].select).toEqual({ characterId: true });
  });

  it("hides unpublished or restricted Favorite and Cart rows from MEMBER without deleting membership", async () => {
    const favoriteFindMany = vi.fn().mockResolvedValue([]);
    const cartFindMany = vi.fn().mockResolvedValue([]);
    await getCharacterCollectionState(USER_B, {
      characterFavorite: { findMany: favoriteFindMany },
      characterCartItem: { findMany: cartFindMany },
    } as unknown as PrismaClient);

    const visible = { status: "ACTIVE", publishedAt: { not: null } };
    expect(favoriteFindMany.mock.calls[0]?.[0].where).toEqual({
      userId: USER_B.userId,
      character: visible,
    });
    expect(cartFindMany.mock.calls[0]?.[0].where).toEqual({
      userId: USER_B.userId,
      character: visible,
    });
  });

  it("upserts only a visible canonical character into Favorites", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "character-1" });
    const favoriteUpsert = vi.fn().mockResolvedValue({ characterId: "character-1" });
    const favoriteCount = vi.fn().mockResolvedValue(3);
    const transaction = { character: { findFirst }, characterFavorite: { upsert: favoriteUpsert } };
    const client = {
      $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)),
      characterFavorite: { count: favoriteCount },
    } as unknown as PrismaClient;

    await expect(setCharacterCollectionMembership(USER_A, "favorites", "character-1", true, client)).resolves.toEqual({
      collection: "favorites", characterId: "character-1", present: true, count: 3,
    });
    expect(findFirst).toHaveBeenCalledWith({ where: { AND: [{ id: "character-1" }, { status: { not: "DELETED" } }] }, select: { id: true } });
    expect(favoriteUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId_characterId: { userId: USER_A.userId, characterId: "character-1" } },
      create: { userId: USER_A.userId, characterId: "character-1" },
    }));
  });

  it("keeps Favorite and Cart mutations independent", async () => {
    const cartDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const cartCount = vi.fn().mockResolvedValue(0);
    const favoriteDeleteMany = vi.fn();
    const client = {
      characterCartItem: { deleteMany: cartDeleteMany, count: cartCount },
      characterFavorite: { deleteMany: favoriteDeleteMany },
    } as unknown as PrismaClient;
    await setCharacterCollectionMembership(USER_A, "cart", "character-1", false, client);
    expect(cartDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_A.userId, characterId: "character-1" } });
    expect(favoriteDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects missing or deleted-hidden characters before collection insertion", async () => {
    const favoriteUpsert = vi.fn();
    const transaction = { character: { findFirst: vi.fn().mockResolvedValue(null) }, characterFavorite: { upsert: favoriteUpsert } };
    const client = { $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)) } as unknown as PrismaClient;
    await expect(setCharacterCollectionMembership(USER_A, "favorites", "missing", true, client)).rejects.toBeInstanceOf(CharacterCollectionNotFoundError);
    expect(favoriteUpsert).not.toHaveBeenCalled();
  });

  it("adds selected characters to Cart atomically with duplicate safety", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "character-1" }, { id: "character-2" }]);
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const count = vi.fn().mockResolvedValue(4);
    const transaction = { character: { findMany }, characterCartItem: { createMany, count } };
    const client = { $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)) } as unknown as PrismaClient;
    const result = await addCharactersToCart(USER_A, ["character-1", "character-2", "character-1"], client);
    expect(result).toEqual({ added: 1, count: 4, characterIds: ["character-1", "character-2"] });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { userId: USER_A.userId, characterId: "character-1" },
        { userId: USER_A.userId, characterId: "character-2" },
      ],
      skipDuplicates: true,
    });
  });

  it("returns explicit card projections for collection review without raw payloads", async () => {
    const findMany = vi.fn().mockResolvedValue([{ character: cardRecord() }]);
    const result = await listCollectionCharacters(USER_A, "cart", {
      characterCartItem: { findMany },
    } as unknown as PrismaClient);
    expect(result[0]).toMatchObject({ id: "character-1", name: "Local Theron", avatarUrl: "/local.webp" });
    const select = findMany.mock.calls[0]?.[0].select.character.select;
    expect(select).not.toHaveProperty("description");
    expect(select).not.toHaveProperty("rawData");
    expect(select.sources.select).not.toHaveProperty("sourceUrl");
  });

  it("searches and sorts Favorites on the server with a 100-card bound", async () => {
    const findMany = vi.fn().mockResolvedValue([{ character: cardRecord() }]);
    const count = vi.fn().mockResolvedValue(101);
    const result = await browseCollectionCharacters(
      USER_A,
      "favorites",
      { query: "Theron", sort: "freshest" },
      { characterFavorite: { findMany, count } } as unknown as PrismaClient,
    );

    expect(result).toMatchObject({ total: 101, limited: true, items: [{ id: "character-1", name: "Local Theron" }] });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: CHARACTER_COLLECTION_VIEW_LIMIT,
      orderBy: [
        { character: { updatedAt: "desc" } },
        { createdAt: "desc" },
        { characterId: "asc" },
      ],
    }));
    expect(findMany.mock.calls[0]?.[0].where.userId).toBe(USER_A.userId);
    expect(findMany.mock.calls[0]?.[0].where.character.OR).toEqual([
      { name: { contains: "Theron", mode: "insensitive" } },
      { nameOverride: { contains: "Theron", mode: "insensitive" } },
      { sources: { some: { creatorName: { contains: "Theron", mode: "insensitive" } } } },
    ]);
    expect(count).toHaveBeenCalledWith({ where: findMany.mock.calls[0]?.[0].where });
  });

  it("uses independent compound identities for two users sharing one canonical Character", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "character-1" });
    const upsert = vi.fn().mockResolvedValue({ characterId: "character-1" });
    const count = vi.fn().mockResolvedValue(1);
    const transaction = { character: { findFirst }, characterFavorite: { upsert } };
    const client = {
      $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)),
      characterFavorite: { count },
    } as unknown as PrismaClient;

    await setCharacterCollectionMembership(USER_A, "favorites", "character-1", true, client);
    await setCharacterCollectionMembership(USER_B, "favorites", "character-1", true, client);

    expect(upsert.mock.calls.map(([query]) => query.where.userId_characterId)).toEqual([
      { userId: USER_A.userId, characterId: "character-1" },
      { userId: USER_B.userId, characterId: "character-1" },
    ]);
    expect(count.mock.calls.map(([query]) => query.where.userId)).toEqual([USER_A.userId, USER_B.userId]);
  });

  it("uses independent Cart identities for two users and removes only the current user's row", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "character-1" });
    const upsert = vi.fn().mockResolvedValue({ characterId: "character-1" });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const count = vi.fn().mockResolvedValue(1);
    const transaction = { character: { findFirst }, characterCartItem: { upsert } };
    const client = {
      $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)),
      characterCartItem: { upsert, deleteMany, count },
    } as unknown as PrismaClient;

    await setCharacterCollectionMembership(USER_A, "cart", "character-1", true, client);
    await setCharacterCollectionMembership(USER_B, "cart", "character-1", true, client);
    await setCharacterCollectionMembership(USER_A, "cart", "character-1", false, client);

    expect(upsert.mock.calls.map(([query]) => query.where.userId_characterId)).toEqual([
      { userId: USER_A.userId, characterId: "character-1" },
      { userId: USER_B.userId, characterId: "character-1" },
    ]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: USER_A.userId, characterId: "character-1" } });
    expect(deleteMany).not.toHaveBeenCalledWith({ where: { userId: USER_B.userId, characterId: "character-1" } });
  });
});

const USER_A = { userId: "user-a", username: "alice", displayName: "Alice", role: "ADMIN" as const };
const USER_B = { userId: "user-b", username: "bob", displayName: "Bob", role: "MEMBER" as const };

function cardRecord() {
  return {
    id: "character-1",
    name: "Theron",
    nameOverride: "Local Theron",
    avatarUrl: "/source.webp",
    avatarUrlOverride: "/local.webp",
    status: "ACTIVE" as const,
    sources: [{ platform: "JANITOR_AI" as const, creatorName: "Creator" }],
    tags: [{ tag: { name: "Fantasy", slug: "fantasy" } }],
  };
}
