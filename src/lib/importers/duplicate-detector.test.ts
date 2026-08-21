import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { analyzeDuplicates } from "./duplicate-detector";
import type { NormalizedCharacter } from "./types";

function createNormalized(overrides: Partial<NormalizedCharacter> = {}): NormalizedCharacter {
  return {
    externalId: "janitor-123",
    platform: "JANITOR_AI",
    sourceUrl: "https://janitorai.com/characters/janitor-123_theron",
    name: "Theron",
    description: "A stoic knight",
    personality: "Stoic, loyal",
    scenario: "Fantasy kingdom",
    exampleDialogs: "Hello traveler",
    avatarUrl: "/theron.webp",
    creator: { externalId: "creator-99", name: "DKU" },
    greetings: [{ content: "Greetings.", position: 0 }],
    tags: [{ name: "Fantasy", slug: "fantasy" }],
    lorebookReferences: [{ externalId: "lore-1", title: "Kingdom" }],
    sourceCreatedAt: new Date("2024-01-15T10:00:00.000Z"),
    sourceUpdatedAt: new Date("2024-06-20T12:00:00.000Z"),
    rawData: { private: true },
    ...overrides,
  };
}

describe("duplicate candidate detector", () => {
  it("classifies exact same platform and externalId as EXACT_SOURCE", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue({ characterId: "existing-char-1" });
    const characterFindMany = vi.fn();
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized();
    const result = await analyzeDuplicates(normalized, { client });

    expect(result).toEqual({
      classification: "EXACT_SOURCE",
      exactCharacterId: "existing-char-1",
      candidates: [],
    });
    expect(characterSourceFindUnique).toHaveBeenCalledWith({
      where: {
        platform_externalId: {
          platform: "JANITOR_AI",
          externalId: "janitor-123",
        },
      },
      select: { characterId: true },
    });
    expect(characterFindMany).not.toHaveBeenCalled();
  });

  it("detects strong cross-source candidates when sourceUrl matches an existing CharacterSource", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([
      {
        id: "char-existing",
        name: "Theron",
        nameOverride: null,
        avatarUrl: "/existing.webp",
        avatarUrlOverride: null,
        sources: [
          {
            platform: "SAUCEPAN",
            creatorName: "DKU",
            sourceUrl: "https://janitorai.com/characters/janitor-123_theron",
          },
        ],
      },
    ]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized({
      externalId: "different-id",
      name: "Different Name",
    });
    const result = await analyzeDuplicates(normalized, { client });

    expect(result.classification).toBe("STRONG_CROSS_SOURCE_CANDIDATE");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      characterId: "char-existing",
      name: "Theron",
      avatarUrl: "/existing.webp",
      creatorName: "DKU",
      confidence: "STRONG",
      evidence: [
        {
          code: "ORIGIN_SOURCE_URL_MATCH",
          label: "Origin source URL matches an existing archive source",
        },
      ],
      sources: [
        expect.objectContaining({ platform: "SAUCEPAN", label: "Saucepan" }),
      ],
    });
  });

  it("classifies exact normalized name + creator display name match as POSSIBLE_DUPLICATE", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([
      {
        id: "char-existing",
        name: "Theron",
        nameOverride: null,
        avatarUrl: "/avatar.webp",
        avatarUrlOverride: null,
        sources: [
          {
            platform: "DATACAT",
            creatorName: "DKU",
            sourceUrl: "https://datacat.example.com/bot/123",
          },
        ],
      },
    ]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized({
      sourceUrl: "https://janitorai.com/characters/new-theron",
    });
    const result = await analyzeDuplicates(normalized, { client });

    expect(result.classification).toBe("POSSIBLE_DUPLICATE");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      characterId: "char-existing",
      name: "Theron",
      creatorName: "DKU",
      confidence: "MEDIUM",
      evidence: [
        {
          code: "EXACT_NAME_AND_CREATOR_MATCH",
          label: "Exact character name and creator display name match",
        },
      ],
      sources: [
        expect.objectContaining({ platform: "DATACAT", label: "Datacat" }),
      ],
    });
  });

  it("returns NO_MATCH when only character name matches but creator does not match", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([
      {
        id: "char-other",
        name: "Theron",
        nameOverride: null,
        avatarUrl: "/other.webp",
        avatarUrlOverride: null,
        sources: [
          {
            platform: "JANITOR_AI",
            creatorName: "UnrelatedAuthor",
            sourceUrl: "https://janitorai.com/characters/other-theron",
          },
        ],
      },
    ]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized({
      name: "Theron",
      creator: { externalId: "c-1", name: "DKU" },
      sourceUrl: "https://janitorai.com/characters/new-theron",
    });
    const result = await analyzeDuplicates(normalized, { client });

    expect(result).toEqual({
      classification: "NO_MATCH",
      candidates: [],
    });
  });

  it("returns NO_MATCH when only creator name matches but character name does not match", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized({
      name: "Unique New Character",
      creator: { externalId: "c-1", name: "DKU" },
    });
    const result = await analyzeDuplicates(normalized, { client });

    expect(result).toEqual({
      classification: "NO_MATCH",
      candidates: [],
    });
  });

  it("returns NO_MATCH for an unrelated character", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized({
      name: "Completely Fresh Name",
      creator: { externalId: "c-2", name: "Fresh Creator" },
    });
    const result = await analyzeDuplicates(normalized, { client });

    expect(result).toEqual({
      classification: "NO_MATCH",
      candidates: [],
    });
  });

  it("caps candidates to a maximum of 5 and excludes deleted characters in query", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `char-${i}`,
        name: "Theron",
        nameOverride: null,
        avatarUrl: `/avatar-${i}.webp`,
        avatarUrlOverride: null,
        sources: [
          {
            platform: "JANITOR_AI",
            creatorName: "DKU",
            sourceUrl: `https://janitorai.com/characters/theron-${i}`,
          },
        ],
      })),
    );
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized();
    const result = await analyzeDuplicates(normalized, { client });

    expect(characterFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5,
        where: expect.objectContaining({
          status: { not: "DELETED" },
        }),
      }),
    );
    expect(result.candidates).toHaveLength(5);
  });

  it("ensures candidate DTOs contain only safe fields and no rawData/greetings/lorebooks", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([
      {
        id: "char-1",
        name: "Theron",
        nameOverride: "Custom Theron",
        avatarUrl: "/source.webp",
        avatarUrlOverride: "/local.webp",
        sources: [
          {
            platform: "JANITOR_AI",
            creatorName: "DKU",
            sourceUrl: "https://janitorai.com/characters/janitor-123_theron",
          },
        ],
      },
    ]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized();
    const result = await analyzeDuplicates(normalized, { client });

    const candidate = result.candidates[0];
    expect(candidate.name).toBe("Custom Theron");
    expect(candidate.avatarUrl).toBe("/local.webp");
    expect(candidate).not.toHaveProperty("rawData");
    expect(candidate).not.toHaveProperty("greetings");
    expect(candidate).not.toHaveProperty("lorebooks");
    expect(candidate).not.toHaveProperty("description");
    expect(candidate).not.toHaveProperty("personality");
    expect(candidate).not.toHaveProperty("scenario");
    expect(candidate).not.toHaveProperty("exampleDialogs");
  });

  it("uses centralized source presentation catalog for candidate source badges", async () => {
    const characterSourceFindUnique = vi.fn().mockResolvedValue(null);
    const characterFindMany = vi.fn().mockResolvedValue([
      {
        id: "char-1",
        name: "Theron",
        nameOverride: null,
        avatarUrl: "/theron.webp",
        avatarUrlOverride: null,
        sources: [
          { platform: "JANITOR_AI", creatorName: "DKU", sourceUrl: "https://example.com/1" },
          { platform: "SAUCEPAN", creatorName: "DKU", sourceUrl: "https://example.com/2" },
          { platform: "DATACAT", creatorName: "DKU", sourceUrl: "https://example.com/3" },
        ],
      },
    ]);
    const client = {
      characterSource: { findUnique: characterSourceFindUnique },
      character: { findMany: characterFindMany },
    } as unknown as PrismaClient;

    const normalized = createNormalized();
    const result = await analyzeDuplicates(normalized, { client });

    const sources = result.candidates[0].sources;
    expect(sources).toEqual([
      expect.objectContaining({ platform: "JANITOR_AI", label: "Janitor AI", mark: "J.AI" }),
      expect.objectContaining({ platform: "SAUCEPAN", label: "Saucepan", mark: "S" }),
      expect.objectContaining({ platform: "DATACAT", label: "Datacat", mark: "D" }),
    ]);
  });
});
