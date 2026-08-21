import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  browseCharacters,
  characterBrowseOrderBy,
  characterBrowseWhere,
  DEFERRED_SOURCE_DATE_SORTS,
  getCharacterBrowseFacets,
  getCharacterQuickView,
  isDeferredSourceDateSort,
  type CharacterBrowseInput,
  type CharacterBrowseSort,
} from "./browse";

describe("character browse query", () => {
  it("uses a bounded page and enforces the maximum page size", async () => {
    const client = browseClient([], 125);
    const result = await browseCharacters(input({ page: 2, pageSize: 500 }), client.value);
    expect(client.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 60, skip: 60 }));
    expect(result.pagination).toMatchObject({ page: 2, pageSize: 60, totalItems: 125, totalPages: 3, hasPrevious: true, hasNext: true });
  });

  it("normalizes invalid page and page-size input", async () => {
    const client = browseClient([], 0);
    const result = await browseCharacters(input({ page: 0, pageSize: -2 }), client.value);
    expect(client.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 30, skip: 0 }));
    expect(result.pagination.page).toBe(1);
  });

  it("returns an empty bounded page with navigation metadata when the page is beyond results", async () => {
    const client = browseClient([], 20);
    const result = await browseCharacters(input({ page: 99 }), client.value);
    expect(result.items).toEqual([]);
    expect(result.pagination).toMatchObject({ page: 99, totalPages: 1, hasPrevious: true, hasNext: false });
  });

  it("searches source and override names plus creator names case-insensitively", () => {
    const where = characterBrowseWhere(input({ query: "Theron" }));
    expect(where.AND).toEqual(expect.arrayContaining([expect.objectContaining({ OR: [
      { name: { contains: "Theron", mode: "insensitive" } },
      { nameOverride: { contains: "Theron", mode: "insensitive" } },
      { sources: { some: { creatorName: { contains: "Theron", mode: "insensitive" } } } },
    ] })]));
  });

  it("combines multi-source, ANY-tag, and status relation filters", () => {
    const where = characterBrowseWhere(input({
      sources: ["JANITOR_AI", "SAUCEPAN"],
      tags: ["fantasy", "romance"],
      statuses: ["ACTIVE", "QUARANTINED"],
    }));
    expect(where.AND).toEqual(expect.arrayContaining([
      { status: { not: "DELETED" } },
      { sources: { some: { platform: { in: ["JANITOR_AI", "SAUCEPAN"] } } } },
      { tags: { some: { tag: { slug: { in: ["fantasy", "romance"] } } } } },
      { status: { in: ["ACTIVE", "QUARANTINED"] } },
    ]));
  });

  it("scopes an author page by exact platform and creator ID without creator-name search leakage", () => {
    const where = characterBrowseWhere(input({
      query: "Hero",
      author: { platform: "JANITOR_AI", externalCreatorId: "creator-1" },
    }));
    expect(where.AND).toEqual(expect.arrayContaining([
      { sources: { some: { platform: "JANITOR_AI", externalCreatorId: "creator-1" } } },
    ]));
    const search = (where.AND as Array<{ OR?: unknown[] }>).find((condition) => condition.OR)?.OR;
    expect(search).toEqual([
      { name: { contains: "Hero", mode: "insensitive" } },
      { nameOverride: { contains: "Hero", mode: "insensitive" } },
    ]);
  });

  it("returns canonical Character rows for author scope rather than querying source rows", async () => {
    const client = browseClient([cardRecord()], 1);
    const result = await browseCharacters(input({ author: { platform: "JANITOR_AI", externalCreatorId: "creator-1" } }), client.value);
    expect(result.items).toHaveLength(1);
    expect(client.findMany).toHaveBeenCalledOnce();
  });

  it.each([
    ["updated", [{ updatedAt: "desc" }, { id: "desc" }]],
    ["archive_updated_newest", [{ updatedAt: "desc" }, { id: "desc" }]],
    ["newest", [{ createdAt: "desc" }, { id: "desc" }]],
    ["archive_added_newest", [{ createdAt: "desc" }, { id: "desc" }]],
    ["oldest", [{ createdAt: "asc" }, { id: "asc" }]],
    ["archive_added_oldest", [{ createdAt: "asc" }, { id: "asc" }]],
    ["name-asc", [{ name: "asc" }, { id: "asc" }]],
    ["name_asc", [{ name: "asc" }, { id: "asc" }]],
    ["name-desc", [{ name: "desc" }, { id: "desc" }]],
    ["name_desc", [{ name: "desc" }, { id: "desc" }]],
  ] as const)("uses deterministic %s ordering", (sort, expected) => {
    expect(characterBrowseOrderBy(sort as CharacterBrowseSort)).toEqual(expected);
  });

  it("identifies deferred source-date sort keys correctly", () => {
    expect(DEFERRED_SOURCE_DATE_SORTS).toEqual([
      "source_created_newest",
      "source_created_oldest",
      "source_updated_newest",
      "source_updated_oldest",
    ]);
    expect(isDeferredSourceDateSort("source_created_newest")).toBe(true);
    expect(isDeferredSourceDateSort("source_created_oldest")).toBe(true);
    expect(isDeferredSourceDateSort("source_updated_newest")).toBe(true);
    expect(isDeferredSourceDateSort("source_updated_oldest")).toBe(true);
    expect(isDeferredSourceDateSort("updated")).toBe(false);
    expect(isDeferredSourceDateSort("archive_updated_newest")).toBe(false);
    expect(isDeferredSourceDateSort("name-asc")).toBe(false);
  });

  it("returns only the current card page and excludes quick-view/detail payload fields", async () => {
    const client = browseClient([cardRecord()], 1);
    const result = await browseCharacters(input(), client.value);
    const select = client.findMany.mock.calls[0]?.[0].select;
    expect(select).not.toHaveProperty("description");
    expect(select).not.toHaveProperty("rawData");
    expect(select).not.toHaveProperty("greetings");
    expect(select).not.toHaveProperty("lorebooks");
    expect(select.sources.select).not.toHaveProperty("sourceUrl");
    expect(result.items[0]).toMatchObject({ name: "Local Theron", avatarUrl: "/local.webp" });
  });

  it("keeps deleted records excluded even when no status filter is selected", async () => {
    const client = browseClient([], 0);
    await browseCharacters(input(), client.value);
    expect(client.findMany.mock.calls[0]?.[0].where.AND).toContainEqual({ status: { not: "DELETED" } });
  });
});

describe("character browse facets", () => {
  it("returns bounded source, status, and tag counts without loading characters", async () => {
    const count = vi.fn()
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(0);
    const groupBy = vi.fn().mockResolvedValue([
      { status: "ACTIVE", _count: { id: 16 } },
      { status: "QUARANTINED", _count: { id: 4 } },
    ]);
    const tagFindMany = vi.fn().mockResolvedValue([{ name: "Fantasy", slug: "fantasy", _count: { characters: 7 } }]);
    const client = { character: { count, groupBy }, tag: { findMany: tagFindMany } } as unknown as PrismaClient;
    const result = await getCharacterBrowseFacets(client);

    expect(result.total).toBe(20);
    expect(result.sources.map(({ count: value }) => value)).toEqual([12, 3, 5, 0]);
    expect(result.statuses).toEqual(expect.arrayContaining([expect.objectContaining({ value: "ACTIVE", count: 16 }), expect.objectContaining({ value: "BLOCKED", count: 0 })]));
    expect(result.tags).toEqual([{ value: "fantasy", label: "Fantasy", count: 7 }]);
    expect(tagFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});

describe("character quick view", () => {
  it("retrieves one focused non-deleted summary with local overrides", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...cardRecord(), description: "Source", descriptionOverride: "Local description", updatedAt: new Date("2026-08-20T00:00:00.000Z") });
    const result = await getCharacterQuickView("character-1", { character: { findFirst } } as unknown as PrismaClient);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "character-1", status: { not: "DELETED" } } }));
    expect(result).toMatchObject({ name: "Local Theron", description: "Local description", updatedAt: "2026-08-20T00:00:00.000Z" });
    expect(findFirst.mock.calls[0]?.[0].select).not.toHaveProperty("rawData");
    expect(findFirst.mock.calls[0]?.[0].select).not.toHaveProperty("greetings");
  });

  it("returns null for missing or deleted-hidden records", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(getCharacterQuickView("missing", { character: { findFirst } } as unknown as PrismaClient)).resolves.toBeNull();
    expect(findFirst.mock.calls[0]?.[0].where.status).toEqual({ not: "DELETED" });
  });
});

function input(overrides: Partial<CharacterBrowseInput> = {}): CharacterBrowseInput {
  return { query: "", sources: [], tags: [], statuses: [], sort: "updated", page: 1, pageSize: 30, ...overrides };
}

function browseClient(records: ReturnType<typeof cardRecord>[], total: number) {
  const findMany = vi.fn().mockResolvedValue(records);
  const count = vi.fn().mockResolvedValue(total);
  return { findMany, value: { character: { findMany, count } } as unknown as PrismaClient };
}

function cardRecord() {
  return {
    id: "character-1",
    name: "Theron",
    nameOverride: "Local Theron",
    avatarUrl: "/source.webp",
    avatarUrlOverride: "/local.webp",
    status: "ACTIVE" as const,
    sources: [{ platform: "JANITOR_AI" as const, creatorName: "Creator", sourceUrl: "https://example.com/character" }],
    tags: [{ tag: { name: "Fantasy", slug: "fantasy" } }],
  };
}
