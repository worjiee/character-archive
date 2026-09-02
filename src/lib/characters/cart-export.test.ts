import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  CHARACTER_CART_EXPORT_FILENAME,
  getCharacterCartExport,
} from "./cart-export";

describe("Cart JSON export", () => {
  it("exports the visible Cart in deterministic order using the bounded character DTO", async () => {
    const findMany = vi.fn().mockResolvedValue([{ character: exportRecord() }]);
    const result = await getCharacterCartExport(
      USER_A,
      undefined,
      { characterCartItem: { findMany } } as unknown as PrismaClient,
    );

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: USER_A.userId, character: { status: { not: "DELETED" } } },
      orderBy: [{ createdAt: "desc" }, { characterId: "asc" }],
    }));
    const characterSelect = findMany.mock.calls[0]?.[0].select.character.select;
    expect(characterSelect).not.toHaveProperty("id");
    expect(characterSelect).not.toHaveProperty("status");
    expect(characterSelect).not.toHaveProperty("rawData");
    expect(characterSelect.sources.select).not.toHaveProperty("rawData");
    expect(result).toMatchObject({
      schema: "character-archive.normalized-character-cart",
      version: 1,
      characters: [{ name: "Local Theron", sources: [{ creatorName: "Creator" }] }],
    });
    expect(JSON.stringify(result)).not.toContain("rawData");
    expect(CHARACTER_CART_EXPORT_FILENAME).toBe("character-archive-cart.json");
  });

  it("produces an explicit empty bundle when the Cart has no visible characters", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await expect(getCharacterCartExport(
      USER_A,
      undefined,
      { characterCartItem: { findMany } } as unknown as PrismaClient,
    )).resolves.toEqual({
      schema: "character-archive.normalized-character-cart",
      version: 1,
      characters: [],
    });
  });

  it("requires ACTIVE publication when a MEMBER exports Cart", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await getCharacterCartExport(
      USER_B,
      undefined,
      { characterCartItem: { findMany } } as unknown as PrismaClient,
    );
    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      userId: USER_B.userId,
      character: { status: "ACTIVE", publishedAt: { not: null } },
    });
  });

  it("bounds checkout to the selected persisted Cart IDs", async () => {
    const findMany = vi.fn().mockResolvedValue([{ character: exportRecord() }]);
    await getCharacterCartExport(
      USER_A,
      ["character-1", "character-2"],
      { characterCartItem: { findMany } } as unknown as PrismaClient,
    );
    expect(findMany.mock.calls[0]?.[0].where).toEqual({
      userId: USER_A.userId,
      characterId: { in: ["character-1", "character-2"] },
      character: { status: { not: "DELETED" } },
    });
  });

  it("treats another user's Cart IDs as absent by always filtering on the current user", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const result = await getCharacterCartExport(
      USER_A,
      ["only-in-user-b-cart"],
      { characterCartItem: { findMany } } as unknown as PrismaClient,
    );
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      userId: USER_A.userId,
      characterId: { in: ["only-in-user-b-cart"] },
    });
    expect(result.characters).toEqual([]);
  });
});

const USER_A = { userId: "user-a", username: "alice", displayName: "Alice", role: "ADMIN" as const };
const USER_B = { userId: "user-b", username: "bob", displayName: "Bob", role: "MEMBER" as const };

function exportRecord() {
  return {
    name: "Theron",
    nameOverride: "Local Theron",
    description: "Description",
    descriptionOverride: null,
    personality: "Personality",
    personalityOverride: null,
    scenario: "Scenario",
    scenarioOverride: null,
    exampleDialogs: null,
    avatarUrl: "/theron.webp",
    avatarUrlOverride: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    sources: [{
      platform: "JANITOR_AI" as const,
      externalId: "source-1",
      externalCreatorId: "creator-1",
      creatorName: "Creator",
      sourceUrl: "https://example.com/character/1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
    }],
    greetings: [],
    tags: [{ tag: { name: "Fantasy", slug: "fantasy" } }],
    lorebooks: [],
  };
}
