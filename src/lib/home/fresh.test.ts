import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import {
  FRESH_ACTIVITY_LIMIT,
  FRESH_CHARACTER_LIMIT,
  FRESH_SOURCE_LIMIT,
  FRESH_TAG_LIMIT,
  freshHref,
  getFreshPageData,
  parseFreshSearchParams,
} from "./fresh";

const NOW = new Date("2026-08-25T12:00:00.000Z");

describe("Fresh archive query", () => {
  it("loads a bounded 24-hour feed without deleted or detail-only data", async () => {
    const client = freshClient();
    const result = await getFreshPageData({ window: "24h", sort: "freshest", now: NOW }, TEST_ADMIN_PRINCIPAL, client.value);
    const query = client.characterFindMany.mock.calls[0]?.[0];

    expect(query).toMatchObject({
      where: { AND: [
        { status: { not: "DELETED" } },
        { status: "ACTIVE", publishedAt: { gte: new Date("2026-08-24T12:00:00.000Z") } },
      ] },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: FRESH_CHARACTER_LIMIT,
    });
    expect(query.select.sources.take).toBe(FRESH_SOURCE_LIMIT);
    expect(query.select.tags.take).toBe(FRESH_TAG_LIMIT);
    expect(query.select).not.toHaveProperty("rawData");
    expect(query.select).not.toHaveProperty("greetings");
    expect(query.select).not.toHaveProperty("lorebooks");
    expect(result.items[0]).toMatchObject({
      name: "Local Theron",
      description: "Local description",
      avatarUrl: "/local.webp",
      publishedAt: "2026-08-25T11:30:00.000Z",
      uploaderName: "Archive Admin",
      tagCount: 7,
    });
  });

  it("uses the truthful week boundary and deterministic oldest ordering", async () => {
    const client = freshClient();
    await getFreshPageData({ window: "week", sort: "oldest", now: NOW }, TEST_ADMIN_PRINCIPAL, client.value);
    expect(client.characterFindMany.mock.calls[0]?.[0]).toMatchObject({
      where: { AND: [
        { status: { not: "DELETED" } },
        { status: "ACTIVE", publishedAt: { gte: new Date("2026-08-18T12:00:00.000Z") } },
      ] },
      orderBy: [{ publishedAt: "asc" }, { id: "asc" }],
    });
  });

  it("combines only bounded current entity timestamps into recent activity", async () => {
    const client = freshClient();
    const result = await getFreshPageData({ window: "24h", sort: "freshest", now: NOW }, TEST_ADMIN_PRINCIPAL, client.value);

    expect(client.characterFindMany.mock.calls[1]?.[0].take).toBe(FRESH_ACTIVITY_LIMIT);
    expect(client.lorebookFindMany.mock.calls[0]?.[0].take).toBe(FRESH_ACTIVITY_LIMIT);
    expect(result.activity).toHaveLength(2);
    expect(result.activity.map(({ label, action }) => ({ label, action }))).toEqual([
      { label: "Local Theron", action: "Updated in archive" },
      { label: "DKU Locations", action: "Added to archive" },
    ]);
    expect(result.activity[0]).not.toHaveProperty("rawData");
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("messages");
  });

  it("limits MEMBER Fresh characters and lorebook activity to ACTIVE visibility", async () => {
    const client = freshClient();
    await getFreshPageData({ window: "24h", sort: "freshest", now: NOW }, TEST_MEMBER_PRINCIPAL, client.value);
    expect(client.characterFindMany.mock.calls[0]?.[0].where.AND).toContainEqual({
      status: "ACTIVE",
      publishedAt: { not: null },
    });
    expect(client.lorebookFindMany.mock.calls[0]?.[0].where).toMatchObject({
      characters: { some: { character: { status: "ACTIVE", publishedAt: { not: null } } } },
    });
  });
});

describe("Fresh URL parsing", () => {
  it("defaults unsafe or unknown values and accepts supported filters", () => {
    expect(parseFreshSearchParams({})).toEqual({ window: "24h", sort: "freshest" });
    expect(parseFreshSearchParams({ window: "week", sort: "oldest" })).toEqual({ window: "week", sort: "oldest" });
    expect(parseFreshSearchParams({ window: "all", sort: "popular" })).toEqual({ window: "24h", sort: "freshest" });
  });

  it("builds canonical Fresh links", () => {
    expect(freshHref({ window: "24h", sort: "freshest" })).toBe("/");
    expect(freshHref({ window: "week", sort: "oldest" })).toBe("/?window=week&sort=oldest");
  });
});

function freshClient() {
  const characterFindMany = vi.fn()
    .mockResolvedValueOnce([characterRecord()])
    .mockResolvedValueOnce([activityCharacterRecord()]);
  const lorebookFindMany = vi.fn().mockResolvedValue([activityLorebookRecord()]);
  return {
    characterFindMany,
    lorebookFindMany,
    value: {
      character: { findMany: characterFindMany },
      lorebook: { findMany: lorebookFindMany },
    } as unknown as PrismaClient,
  };
}

function characterRecord() {
  return {
    id: "character-1",
    name: "Theron",
    nameOverride: "Local Theron",
    description: "Source description",
    descriptionOverride: "<p>Local description</p><script>hidden()</script>",
    avatarUrl: "/source.webp",
    avatarUrlOverride: "/local.webp",
    status: "ACTIVE" as const,
    publishedAt: new Date("2026-08-25T11:30:00.000Z"),
    firstAddedBy: { displayName: "Archive Admin", username: "admin" },
    sources: [{ platform: "JANITOR_AI" as const, creatorName: "Creator" }],
    tags: [{ tag: { name: "Fantasy", slug: "fantasy" } }],
    _count: { tags: 7 },
  };
}

function activityCharacterRecord() {
  return {
    id: "character-1",
    name: "Theron",
    nameOverride: "Local Theron",
    createdAt: new Date("2026-08-20T10:00:00.000Z"),
    updatedAt: new Date("2026-08-25T11:58:00.000Z"),
    sources: [{ platform: "JANITOR_AI" as const }],
  };
}

function activityLorebookRecord() {
  return {
    id: "lorebook-1",
    title: "DKU Locations",
    sourcePlatform: "JANITOR_AI" as const,
    createdAt: new Date("2026-08-25T11:00:00.000Z"),
    updatedAt: new Date("2026-08-25T11:00:00.500Z"),
  };
}
