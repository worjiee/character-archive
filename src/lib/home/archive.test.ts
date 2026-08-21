import { describe, expect, it, vi } from "vitest";
import {
  getHomeArchiveData,
  HOME_CHARACTER_LIMIT,
  HOME_LOREBOOK_LIMIT,
} from "./archive";

describe("home archive composition", () => {
  it("requests bounded, all-source character and lorebook pages in recent order", async () => {
    const browseCharacters = vi.fn().mockResolvedValue(characterResult());
    const getCharacterBrowseFacets = vi.fn().mockResolvedValue(characterFacets());
    const browseLorebooks = vi.fn().mockResolvedValue(lorebookResult());

    await getHomeArchiveData({
      browseCharacters,
      getCharacterBrowseFacets,
      browseLorebooks,
    });

    expect(browseCharacters).toHaveBeenCalledWith({
      query: "",
      sources: [],
      tags: [],
      statuses: [],
      sort: "updated",
      page: 1,
      pageSize: HOME_CHARACTER_LIMIT,
    });
    expect(browseLorebooks).toHaveBeenCalledWith({
      query: "",
      sources: [],
      sort: "updated",
      page: 1,
      pageSize: HOME_LOREBOOK_LIMIT,
    });
    expect(HOME_CHARACTER_LIMIT).toBeLessThanOrEqual(12);
    expect(HOME_LOREBOOK_LIMIT).toBeLessThanOrEqual(8);
  });

  it("returns card/list DTO results without requesting a detail read", async () => {
    const characters = characterResult();
    const facets = characterFacets();
    const lorebooks = lorebookResult();
    const result = await getHomeArchiveData({
      browseCharacters: vi.fn().mockResolvedValue(characters),
      getCharacterBrowseFacets: vi.fn().mockResolvedValue(facets),
      browseLorebooks: vi.fn().mockResolvedValue(lorebooks),
    });

    expect(result).toEqual({ characters, characterFacets: facets, lorebooks });
    expect(result.characters.items[0]).not.toHaveProperty("rawData");
    expect(result.characters.items[0]).not.toHaveProperty("greetings");
    expect(result.lorebooks.items[0]).not.toHaveProperty("rawData");
    expect(result.lorebooks.items[0]).not.toHaveProperty("entries");
    expect(result.lorebooks.items[0]).not.toHaveProperty("characters");
  });
});

function characterResult() {
  return {
    items: [{ id: "character-1", name: "Theron", avatarUrl: null, status: "ACTIVE" as const, sources: [], tags: [] }],
    pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, hasPrevious: false, hasNext: false },
  };
}

function characterFacets() {
  return {
    total: 1,
    sources: [{ value: "JANITOR_AI" as const, label: "Janitor AI", count: 1 }],
    statuses: [{ value: "ACTIVE" as const, label: "Active", count: 1 }],
    tags: [],
  };
}

function lorebookResult() {
  return {
    items: [{
      id: "lorebook-1",
      externalId: "source-1",
      title: "Locations",
      description: null,
      sourcePlatform: "JANITOR_AI" as const,
      sourceUrl: "https://example.com/lorebook",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-02T00:00:00.000Z"),
      lastSyncedAt: null,
      entryCount: 2,
      characterCount: 1,
    }],
    pagination: { page: 1, pageSize: 6, totalItems: 1, totalPages: 1, hasPrevious: false, hasNext: false },
  };
}
