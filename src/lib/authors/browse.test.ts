import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import { browseAuthorCharacters, browseAuthors, getAuthorProfile, searchAuthorTags } from "./browse";

const identity = { platform: "JANITOR_AI" as const, kind: "EXTERNAL_ID" as const, value: "creator-1" };

describe("author directory service", () => {
  it("returns a bounded lookahead page with distinct source-scoped identities", async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce(Array.from({ length: 31 }, (_, index) => ({ platform: "JANITOR_AI", identityKind: "EXTERNAL_ID", identityValue: `creator-${index}`, creatorName: `Creator ${index}`, characterCount: 2, latestPublishedAt: new Date("2026-08-20"), isFavorited: false, favoriteProvenance: [] }))).mockResolvedValueOnce([]);
    const result = await browseAuthors({ query: "", source: "ALL", sort: "name-asc", favoriteOnly: false, page: 2, pageSize: 30 }, TEST_ADMIN_PRINCIPAL, { $queryRaw: queryRaw } as unknown as PrismaClient);
    expect(result.items).toHaveLength(30);
    expect(result.pagination).toEqual({ page: 2, pageSize: 30, hasPrevious: true, hasNext: true });
    expect(result.items[0]?.identity).toEqual({ platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "creator-0" });
  });

  it("uses the same active-published catalog policy for ordinary ADMIN and MEMBER calls", async () => {
    for (const principal of [TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL]) {
      const queryRaw = vi.fn().mockResolvedValue([]);
      await browseAuthors({ query: "", source: "ALL", sort: "recent", favoriteOnly: false, page: 1, pageSize: 30 }, principal, { $queryRaw: queryRaw } as unknown as PrismaClient);
      expect(JSON.stringify(queryRaw.mock.calls[0]?.[0])).toContain("publishedAt");
      expect(JSON.stringify(queryRaw.mock.calls[0]?.[0])).toContain("ACTIVE");
    }
  });

  it("reports publication chronology and never invents a profile URL", async () => {
    const publishedAt = new Date("2026-08-21");
    const queryRaw = vi.fn().mockResolvedValue([{ platform: "JANITOR_AI", identityKind: "EXTERNAL_ID", identityValue: "creator-1", creatorName: "Creator", characterCount: 4, latestPublishedAt: publishedAt, isFavorited: true, favoriteProvenance: ["MANUAL"] }]);
    await expect(getAuthorProfile(identity, TEST_MEMBER_PRINCIPAL, { $queryRaw: queryRaw } as unknown as PrismaClient)).resolves.toEqual({ identity, creatorName: "Creator", characterCount: 4, latestPublishedAt: publishedAt, sourceProfileUrl: null, isFavorited: true, favoriteProvenance: ["MANUAL"] });
  });

  it("selects the freshest synchronized creator display name for a stable identity", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await browseAuthors({ query: "", source: "ALL", sort: "name-asc", favoriteOnly: false, page: 1, pageSize: 30 }, TEST_MEMBER_PRINCIPAL, { $queryRaw: queryRaw } as unknown as PrismaClient);
    const sql = JSON.stringify(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("lastSuccessfulSyncAt");
    expect(sql).toContain("lastSyncedAt");
    expect(sql).toContain("ARRAY_AGG");
    expect(sql).not.toContain('MIN(\\\"creatorName\\\")');
  });

  it("applies Favorite Creators filtering with the authenticated user ID", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await browseAuthors({ query: "", source: "ALL", sort: "name-asc", favoriteOnly: true, page: 1, pageSize: 30 }, TEST_MEMBER_PRINCIPAL, { $queryRaw: queryRaw } as unknown as PrismaClient);
    const sql = JSON.stringify(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("UserFavoriteCreator");
    expect(sql).toContain(TEST_MEMBER_PRINCIPAL.userId);
  });

  it.each([
    ["name-desc", "DESC"],
    ["characters-desc", "characterCount"],
    ["recent", "latestPublishedAt"],
  ] as const)("uses deterministic %s ordering with server-side source/search filters", async (sort, marker) => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await browseAuthors({ query: "dark", source: "SAUCEPAN", sort, favoriteOnly: false, page: 1, pageSize: 30 }, TEST_MEMBER_PRINCIPAL, { $queryRaw: queryRaw } as unknown as PrismaClient);
    const sql = JSON.stringify(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("SAUCEPAN");
    expect(sql).toContain("dark");
    expect(sql).toContain(marker);
  });
});

describe("author character and tag services", () => {
  it("keeps character queries bounded and canonical tags as ANY-match filters", async () => {
    const queryRaw = vi.fn().mockResolvedValueOnce([{ id: "character-1" }]).mockResolvedValueOnce([{ count: 1 }]);
    const findMany = vi.fn().mockResolvedValue([{ id: "character-1", name: "One", nameOverride: null, avatarUrl: null, avatarUrlOverride: null, status: "ACTIVE", sources: [], tags: [] }]);
    const result = await browseAuthorCharacters(identity, { query: "", tags: ["fantasy", "romance"], sort: "published-newest", page: 1, pageSize: 30 }, TEST_MEMBER_PRINCIPAL, { $queryRaw: queryRaw, character: { findMany } } as unknown as PrismaClient);
    expect(result.items).toHaveLength(1);
    expect(result.pagination.totalItems).toBe(1);
    const sql = JSON.stringify(queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("slug IN");
    expect(sql).toContain("SELECT DISTINCT c.id");
    expect(sql).toContain("publishedAt");
  });

  it("returns alphabetical source-provenance tags with distinct character counts and bounds", async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ tagId: "tag-1", slug: "fantasy", canonicalName: "Fantasy", displayLabel: "#Fantasy", normalizedLabel: "fantasy", characterCount: 3, totalRows: 1 }]);
    const result = await searchAuthorTags(identity, { query: "#Fan", page: 1, limit: 30 }, TEST_MEMBER_PRINCIPAL, { $queryRaw: queryRaw } as unknown as PrismaClient);
    expect(result.items).toEqual([{ tagId: "tag-1", slug: "fantasy", canonicalName: "Fantasy", displayLabel: "#Fantasy", count: 3, group: "F" }]);
    expect(result).toMatchObject({ limit: 30, total: 1, hasMore: false });
    expect(JSON.stringify(queryRaw.mock.calls[0]?.[0])).not.toContain("rawData");
  });
});
