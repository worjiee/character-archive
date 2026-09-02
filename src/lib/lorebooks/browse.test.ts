import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import {
  browseLorebooks,
  getLorebookBrowseFacets,
  lorebookBrowseOrderBy,
  lorebookBrowseWhere,
  type LorebookBrowseInput,
  type LorebookBrowseSort,
} from "./browse";

describe("lorebook browse query", () => {
  it("uses bounded offset pagination and enforces its maximum", async () => {
    const client = mockClient([], 121);
    const result = await browseLorebooks(input({ page: 2, pageSize: 500 }), TEST_ADMIN_PRINCIPAL, client.value);
    expect(client.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 60, skip: 60 }));
    expect(result.pagination).toMatchObject({ page: 2, pageSize: 60, totalPages: 3, hasNext: true });
  });

  it("normalizes invalid pages and page sizes", async () => {
    const client = mockClient([], 0);
    const result = await browseLorebooks(input({ page: -1, pageSize: 0 }), TEST_ADMIN_PRINCIPAL, client.value);
    expect(client.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 30, skip: 0 }));
    expect(result.pagination.page).toBe(1);
  });

  it("returns safe metadata for a page beyond the result set", async () => {
    const client = mockClient([], 8);
    const result = await browseLorebooks(input({ page: 50 }), TEST_ADMIN_PRINCIPAL, client.value);
    expect(result.items).toEqual([]);
    expect(result.pagination).toMatchObject({ page: 50, totalPages: 1, hasPrevious: true, hasNext: false });
  });

  it("searches title/description case-insensitively and filters multiple sources", () => {
    expect(lorebookBrowseWhere(input({ query: "academy", sources: ["JANITOR_AI", "DATACAT"] }))).toEqual({
      OR: [
        { title: { contains: "academy", mode: "insensitive" } },
        { description: { contains: "academy", mode: "insensitive" } },
      ],
      sourcePlatform: { in: ["JANITOR_AI", "DATACAT"] },
    });
  });

  it.each([
    ["updated", [{ updatedAt: "desc" }, { id: "desc" }]],
    ["newest", [{ createdAt: "desc" }, { id: "desc" }]],
    ["oldest", [{ createdAt: "asc" }, { id: "asc" }]],
    ["title-asc", [{ title: "asc" }, { id: "asc" }]],
    ["title-desc", [{ title: "desc" }, { id: "desc" }]],
  ] as const)("uses deterministic %s ordering", (sort, expected) => {
    expect(lorebookBrowseOrderBy(sort as LorebookBrowseSort)).toEqual(expected);
  });

  it("returns counts without loading entries, attached characters, or rawData", async () => {
    const client = mockClient([record()], 1);
    const result = await browseLorebooks(input(), TEST_ADMIN_PRINCIPAL, client.value);
    const select = client.findMany.mock.calls[0]?.[0].select;
    expect(select._count).toEqual({ select: { entries: true, characters: true } });
    expect(select).not.toHaveProperty("entries");
    expect(select).not.toHaveProperty("characters");
    expect(select).not.toHaveProperty("rawData");
    expect(result.items[0]).toMatchObject({ entryCount: 4, characterCount: 2 });
  });

  it("returns bounded source facets", async () => {
    const groupBy = vi.fn().mockResolvedValue([{ sourcePlatform: "JANITOR_AI", _count: { id: 8 } }, { sourcePlatform: "SAUCEPAN", _count: { id: 2 } }]);
    const result = await getLorebookBrowseFacets(TEST_ADMIN_PRINCIPAL, { lorebook: { groupBy } } as unknown as PrismaClient);
    expect(result.total).toBe(10);
    expect(result.sources).toEqual(expect.arrayContaining([expect.objectContaining({ value: "JANITOR_AI", count: 8 }), expect.objectContaining({ value: "DATACAT", count: 0 })]));
  });

  it("limits MEMBER lorebooks to those attached to ACTIVE characters", () => {
    expect(lorebookBrowseWhere(input(), TEST_MEMBER_PRINCIPAL)).toEqual({
      characters: { some: { character: { status: "ACTIVE", publishedAt: { not: null } } } },
    });
  });
});

function input(overrides: Partial<LorebookBrowseInput> = {}): LorebookBrowseInput {
  return { query: "", sources: [], sort: "updated", page: 1, pageSize: 30, ...overrides };
}

function mockClient(records: ReturnType<typeof record>[], total: number) {
  const findMany = vi.fn().mockResolvedValue(records);
  const count = vi.fn().mockResolvedValue(total);
  return { findMany, value: { lorebook: { findMany, count } } as unknown as PrismaClient };
}

function record() {
  return {
    id: "lorebook-1",
    externalId: "external-1",
    title: "Archive Places",
    description: "Locations",
    sourcePlatform: "JANITOR_AI" as const,
    sourceUrl: "https://example.com/lorebook",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-02T00:00:00.000Z"),
    lastSyncedAt: null,
    _count: { entries: 4, characters: 2 },
  };
}
