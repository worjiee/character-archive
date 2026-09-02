import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getSelectedCatalogTags, searchCatalogTags } from "./search";

describe("catalog tag search", () => {
  it("maps canonical results to a compact alphabetical DTO", async () => {
    const { client, queryRaw } = clientWithRows([
      row({ displayLabel: "Adventure", normalizedLabel: "adventure", characterCount: 12, totalCount: 2 }),
      row({ tagId: "tag-fantasy", slug: "fantasy", canonicalName: "#Fantasy", displayLabel: "#Fantasy", normalizedLabel: "fantasy", characterCount: 8, totalCount: 2 }),
    ]);
    const result = await searchCatalogTags({ query: "", source: "ALL", page: 1, limit: 50 }, client);
    expect(result).toEqual({
      items: [
        expect.objectContaining({ displayLabel: "Adventure", source: "ALL", count: 12, group: "A" }),
        expect.objectContaining({ displayLabel: "#Fantasy", source: "ALL", count: 8, group: "F" }),
      ],
      page: 1,
      limit: 50,
      total: 2,
      hasMore: false,
    });
    expect(queryRaw).toHaveBeenCalledOnce();
    const sql = (queryRaw.mock.calls[0]?.[0] as { strings?: string[] }).strings?.join(" ") ?? "";
    expect(sql).toContain('c."status" = \'ACTIVE\'');
    expect(sql).toContain('c."publishedAt" IS NOT NULL');
    expect(sql).toContain('COUNT(DISTINCT ct."characterId")');
    expect(sql).toContain('ORDER BY "matchRank", "normalizedLabel", "displayLabel", "tagId"');
    expect(sql).not.toContain("rawData");
    expect(result.items[0]).not.toHaveProperty("characters");
    expect(result.items[0]).not.toHaveProperty("rawData");
  });

  it("resolves selected chips independently of the current result page", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { slug: "male", name: "Male" },
      { slug: "fantasy", name: "Fantasy" },
    ]);
    const client = { tag: { findMany } } as unknown as PrismaClient;
    await expect(getSelectedCatalogTags(["fantasy", "male"], client)).resolves.toEqual([
      { slug: "fantasy", label: "Fantasy" },
      { slug: "male", label: "Male" },
    ]);
    expect(findMany.mock.calls[0]?.[0].where.characters.some.character).toEqual({
      status: "ACTIVE",
      publishedAt: { not: null },
    });
  });

  it("returns source raw labels while retaining canonical identity", async () => {
    const { client } = clientWithRows([
      row({ displayLabel: "#Male", normalizedLabel: "male", canonicalName: "Male", slug: "male", characterCount: 4, totalCount: 1, platform: "SAUCEPAN" }),
    ]);
    const result = await searchCatalogTags({ query: "#Male", source: "SAUCEPAN", page: 1, limit: 50 }, client);
    expect(result.items[0]).toMatchObject({
      slug: "male",
      canonicalName: "Male",
      displayLabel: "#Male",
      source: "SAUCEPAN",
      count: 4,
      group: "M",
    });
  });

  it("honors pagination metadata and an empty page total", async () => {
    const first = clientWithRows([row({ totalCount: 75 })]);
    await expect(searchCatalogTags({ query: "", source: "ALL", page: 1, limit: 50 }, first.client))
      .resolves.toMatchObject({ total: 75, hasMore: true });

    const empty = clientWithRows([{
      tagId: null,
      slug: null,
      canonicalName: null,
      displayLabel: null,
      normalizedLabel: null,
      platform: null,
      characterCount: null,
      totalCount: 75,
    }]);
    await expect(searchCatalogTags({ query: "", source: "ALL", page: 3, limit: 50 }, empty.client))
      .resolves.toEqual({ items: [], page: 3, limit: 50, total: 75, hasMore: false });
  });
});

function clientWithRows(rows: unknown[]) {
  const queryRaw = vi.fn().mockResolvedValue(rows);
  return { queryRaw, client: { $queryRaw: queryRaw } as unknown as PrismaClient };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    tagId: "tag-adventure",
    slug: "adventure",
    canonicalName: "Adventure",
    displayLabel: "Adventure",
    normalizedLabel: "adventure",
    platform: null,
    characterCount: 1,
    totalCount: 1,
    ...overrides,
  };
}
