import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  authorBrowseOrderBy,
  authorBrowseWhere,
  browseAuthors,
  getAuthorCharacterFacets,
  getAuthorSummary,
  type AuthorBrowseInput,
  type AuthorBrowseSort,
} from "./browse";

describe("author browse query", () => {
  it("uses a bounded grouped page with one lookahead record", async () => {
    const groupBy = vi.fn().mockResolvedValue(Array.from({ length: 31 }, (_, index) => group({ externalCreatorId: `creator-${index}` })));
    const result = await browseAuthors(input({ page: 2 }), { characterSource: { groupBy } } as unknown as PrismaClient);

    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ take: 31, skip: 30 }));
    expect(result.items).toHaveLength(30);
    expect(result.pagination).toEqual({ page: 2, pageSize: 30, hasPrevious: true, hasNext: true });
  });

  it("keeps the same creator name on different platforms as separate identities", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      group({ platform: "JANITOR_AI", externalCreatorId: "creator-1", creatorName: "Shared Name" }),
      group({ platform: "DATACAT", externalCreatorId: "creator-1", creatorName: "Shared Name" }),
    ]);
    const result = await browseAuthors(input(), { characterSource: { groupBy } } as unknown as PrismaClient);

    expect(result.items.map(({ platform, externalCreatorId }) => [platform, externalCreatorId])).toEqual([
      ["JANITOR_AI", "creator-1"],
      ["DATACAT", "creator-1"],
    ]);
  });

  it("returns source-record character counts and honest archive activity dates", async () => {
    const latestSync = new Date("2026-08-20T00:00:00.000Z");
    const groupBy = vi.fn().mockResolvedValue([group({ characterCount: 7, lastSuccessfulSyncAt: latestSync })]);
    const result = await browseAuthors(input(), { characterSource: { groupBy } } as unknown as PrismaClient);

    expect(result.items[0]).toMatchObject({ characterCount: 7, latestArchiveActivityAt: latestSync });
    const args = groupBy.mock.calls[0]?.[0];
    expect(args.by).toEqual(["platform", "externalCreatorId"]);
    expect(args).not.toHaveProperty("select.rawData");
  });

  it("searches creator names and excludes deleted characters and missing creator IDs", () => {
    expect(authorBrowseWhere(" Creator ")).toEqual({
      externalCreatorId: { not: null },
      AND: [
        { externalCreatorId: { not: "" } },
        { character: { status: { not: "DELETED" } } },
        { creatorName: { contains: "Creator", mode: "insensitive" } },
      ],
    });
  });

  it.each([
    ["name-asc", [{ _max: { creatorName: "asc" } }, { platform: "asc" }, { externalCreatorId: "asc" }]],
    ["name-desc", [{ _max: { creatorName: "desc" } }, { platform: "asc" }, { externalCreatorId: "asc" }]],
    ["characters-desc", [{ _count: { characterId: "desc" } }, { _max: { creatorName: "asc" } }, { platform: "asc" }, { externalCreatorId: "asc" }]],
    ["recent", [{ _max: { lastSuccessfulSyncAt: "desc" } }, { _max: { firstSeenAt: "desc" } }, { platform: "asc" }, { externalCreatorId: "asc" }]],
  ] as const)("uses deterministic %s ordering", (sort, expected) => {
    expect(authorBrowseOrderBy(sort as AuthorBrowseSort)).toEqual(expected);
  });
});

describe("author detail queries", () => {
  const author = { platform: "JANITOR_AI" as const, externalCreatorId: "creator-1" };

  it("retrieves the latest source-scoped display name without raw source data", async () => {
    const findFirst = vi.fn().mockResolvedValue({ ...author, creatorName: "Creator" });
    const result = await getAuthorSummary(author, { characterSource: { findFirst } } as unknown as PrismaClient);

    expect(result).toEqual({ ...author, creatorName: "Creator" });
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: author }));
    expect(findFirst.mock.calls[0]?.[0].select).toEqual({ platform: true, externalCreatorId: true, creatorName: true });
  });

  it("returns null for a missing source-scoped author", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(getAuthorSummary(author, { characterSource: { findFirst } } as unknown as PrismaClient)).resolves.toBeNull();
  });

  it("derives tag and status facets only from the author's non-deleted characters", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { status: "ACTIVE", _count: { id: 4 } },
      { status: "QUARANTINED", _count: { id: 1 } },
    ]);
    const findMany = vi.fn().mockResolvedValue([
      { name: "Fantasy", slug: "fantasy", _count: { characters: 3 } },
      { name: "Historical", slug: "historical", _count: { characters: 1 } },
    ]);
    const client = { character: { groupBy }, tag: { findMany } } as unknown as PrismaClient;
    const result = await getAuthorCharacterFacets(author, client);

    const expectedCharacterWhere = {
      status: { not: "DELETED" },
      sources: { some: author },
    };
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expectedCharacterWhere }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 100,
      where: { characters: { some: { character: expectedCharacterWhere } } },
    }));
    expect(result.total).toBe(5);
    expect(result.tags).toEqual([
      { value: "fantasy", label: "Fantasy", count: 3 },
      { value: "historical", label: "Historical", count: 1 },
    ]);
    expect(result.statuses).toEqual(expect.arrayContaining([
      { value: "ACTIVE", label: "Active", count: 4 },
      { value: "BLOCKED", label: "Blocked", count: 0 },
    ]));
  });
});

function input(overrides: Partial<AuthorBrowseInput> = {}): AuthorBrowseInput {
  return { query: "", sort: "name-asc", page: 1, pageSize: 30, ...overrides };
}

function group(overrides: {
  platform?: "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";
  externalCreatorId?: string;
  creatorName?: string | null;
  characterCount?: number;
  firstSeenAt?: Date;
  lastSuccessfulSyncAt?: Date | null;
} = {}) {
  return {
    platform: overrides.platform ?? "JANITOR_AI",
    externalCreatorId: overrides.externalCreatorId ?? "creator-1",
    _count: { characterId: overrides.characterCount ?? 2 },
    _max: {
      creatorName: overrides.creatorName ?? "Creator",
      firstSeenAt: overrides.firstSeenAt ?? new Date("2026-08-01T00:00:00.000Z"),
      lastSuccessfulSyncAt: overrides.lastSuccessfulSyncAt === undefined
        ? new Date("2026-08-10T00:00:00.000Z")
        : overrides.lastSuccessfulSyncAt,
    },
  };
}
