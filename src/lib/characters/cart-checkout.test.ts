import { strFromU8, unzipSync } from "fflate";
import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import {
  createCharacterCartCheckoutZip,
  getCharacterCartCheckoutItems,
  parseCharacterCartCheckoutBody,
  sanitizeArchivePathSegment,
  type CharacterCartCheckoutItem,
} from "./cart-checkout";
import { CHARACTER_CART_CHECKOUT_MAX_CHARACTERS } from "./cart-checkout-constants";
import type { CharacterExportDto } from "./export";

describe("Cart ZIP checkout", () => {
  it("strictly validates only bounded, unique canonical Character IDs", () => {
    expect(parseCharacterCartCheckoutBody({ characterIds: ["character-1", "character_2"] })).toEqual(["character-1", "character_2"]);
    expect(() => parseCharacterCartCheckoutBody({ characterIds: ["character-1"], userId: "user-b" })).toThrow("only characterIds");
    expect(() => parseCharacterCartCheckoutBody({ characterIds: ["character-1", "character-1"] })).toThrow("must not contain duplicates");
    expect(() => parseCharacterCartCheckoutBody({
      characterIds: Array.from({ length: CHARACTER_CART_CHECKOUT_MAX_CHARACTERS + 1 }, (_, index) => `character-${index}`),
    })).toThrow(`maximum of ${CHARACTER_CART_CHECKOUT_MAX_CHARACTERS}`);
  });

  it("queries only the active user's visible Cart rows using the safe export projection", async () => {
    const findMany = vi.fn().mockResolvedValue([{ character: exportRecord("character-1") }]);
    const items = await getCharacterCartCheckoutItems(
      TEST_MEMBER_PRINCIPAL,
      ["character-1", "only-user-b-has-this"],
      { characterCartItem: { findMany } } as unknown as PrismaClient,
    );
    const query = findMany.mock.calls[0]?.[0];
    expect(query.where).toEqual({
      userId: TEST_MEMBER_PRINCIPAL.userId,
      characterId: { in: ["character-1", "only-user-b-has-this"] },
      character: { status: "ACTIVE", publishedAt: { not: null } },
    });
    expect(query.select.character.select).not.toHaveProperty("rawData");
    expect(query.select.character.select.sources.select).not.toHaveProperty("rawData");
    expect(query.select.character.select.lorebooks.select.lorebook.select).not.toHaveProperty("entries");
    expect(items.map(({ id }) => id)).toEqual(["character-1"]);
  });

  it("creates an actual author-grouped ZIP with a versioned manifest and normalized CharacterExportDto files", () => {
    const now = new Date("2026-08-29T10:00:00.000Z");
    const checkout = createCharacterCartCheckoutZip([
      checkoutItem("character-2", "Beta", "Alice", "JANITOR_AI", "creator-a"),
      checkoutItem("character-1", "Alpha", "Alice", "JANITOR_AI", "creator-a"),
      checkoutItem("character-3", "Mystery", null, null, null),
    ], TEST_MEMBER_PRINCIPAL, now);
    const files = unzipSync(checkout.bytes);
    const paths = Object.keys(files).sort();
    expect(paths).toEqual([
      "authors/alice/alpha/character.json",
      "authors/alice/beta/character.json",
      "authors/unknown-author/mystery/character.json",
      "manifest.json",
    ]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest).toMatchObject({
      format: "character-archive-checkout",
      version: 1,
      exportedAt: now.toISOString(),
      exportedBy: "Member",
      characterCount: 3,
      authorCount: 2,
      authors: [
        { name: "Alice", characterCount: 2, sourcePlatform: "JANITOR_AI" },
        { name: "Unknown author", characterCount: 1, sourcePlatform: null },
      ],
    });
    expect(JSON.parse(strFromU8(files["authors/alice/alpha/character.json"]!))).toMatchObject({
      schema: "character-archive.normalized-character",
      version: 1,
      character: { name: "Alpha" },
    });
    expect(strFromU8(files["authors/alice/alpha/character.json"]!)).not.toContain("rawData");
  });

  it("sanitizes traversal/reserved names and resolves collisions deterministically", () => {
    expect(sanitizeArchivePathSegment("../../CON", "author")).toBe("author-con");
    const checkout = createCharacterCartCheckoutZip([
      checkoutItem("id-1", "Same", "../CON", "JANITOR_AI", "a"),
      checkoutItem("id-2", "Same", "../CON", "JANITOR_AI", "a"),
    ], TEST_MEMBER_PRINCIPAL, new Date("2026-08-29T10:00:00.000Z"));
    const paths = Object.keys(unzipSync(checkout.bytes));
    expect(paths).toContain("authors/author-con/same/character.json");
    expect(paths.some((path) => /^authors\/author-con\/same-[a-z0-9]{7}\/character\.json$/u.test(path))).toBe(true);
    expect(paths.every((path) => !path.includes(".."))).toBe(true);
  });

  it("disambiguates same-name source-scoped author folders and reserves unknown-author", () => {
    const checkout = createCharacterCartCheckoutZip([
      checkoutItem("id-1", "One", "Same Name", "JANITOR_AI", "a"),
      checkoutItem("id-2", "Two", "Same Name", "SAUCEPAN", "b"),
      checkoutItem("id-3", "Three", "Unknown Author", "DATACAT", "c"),
      checkoutItem("id-4", "Four", null, null, null),
    ], TEST_MEMBER_PRINCIPAL, new Date("2026-08-29T10:00:00.000Z"));
    const paths = Object.keys(unzipSync(checkout.bytes));
    expect(paths).toContain("authors/same-name/one/character.json");
    expect(paths).toContain("authors/same-name-saucepan/two/character.json");
    expect(paths).toContain("authors/unknown-author-datacat/three/character.json");
    expect(paths).toContain("authors/unknown-author/four/character.json");
  });
});

function checkoutItem(
  id: string,
  name: string,
  authorName: string | null,
  platform: string | null,
  creatorId: string | null,
): CharacterCartCheckoutItem {
  const unknown = !authorName || !platform;
  return {
    id,
    export: exportDto(name, platform, authorName, creatorId),
    author: {
      key: unknown ? "unknown-author" : `source:${platform}:creator:${creatorId}`,
      name: authorName ?? "Unknown author",
      platform,
      platformLabel: platform,
      externalCreatorId: creatorId,
      unknown,
    },
  };
}

function exportDto(name: string, platform: string | null, creatorName: string | null, creatorId: string | null): CharacterExportDto {
  return {
    schema: "character-archive.normalized-character",
    version: 1,
    character: {
      name,
      description: "Description",
      personality: null,
      scenario: null,
      exampleDialogs: null,
      avatarUrl: null,
      archiveCreatedAt: "2026-08-01T00:00:00.000Z",
      archiveUpdatedAt: "2026-08-20T00:00:00.000Z",
      sources: platform ? [{
        platform,
        externalId: `source-${name}`,
        externalCreatorId: creatorId,
        creatorName,
        sourceUrl: "https://example.com/character",
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
      }] : [],
      greetings: [],
      tags: [],
      lorebooks: [],
    },
  };
}

function exportRecord(id: string) {
  return {
    id,
    name: "Theron",
    nameOverride: null,
    description: "Description",
    descriptionOverride: null,
    personality: null,
    personalityOverride: null,
    scenario: null,
    scenarioOverride: null,
    exampleDialogs: null,
    avatarUrl: null,
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
    tags: [],
    lorebooks: [],
  };
}
