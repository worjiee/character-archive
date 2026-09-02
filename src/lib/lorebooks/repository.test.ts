import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import { getLorebookById } from "./repository";

describe("lorebook repository", () => {
  it("returns normalized entries in insertion order and all attached characters", async () => {
    const findFirst = vi.fn().mockResolvedValue(detailRecord());

    const result = await getLorebookById(
      "lorebook-1",
      TEST_ADMIN_PRINCIPAL,
      { lorebook: { findFirst } } as unknown as PrismaClient,
    );
    const query = findFirst.mock.calls[0]?.[0];

    expect(query.select.entries.orderBy).toEqual([
      { insertionOrder: "asc" },
      { id: "asc" },
    ]);
    expect(query.select.entries.select).not.toHaveProperty("rawData");
    expect(query.select.entries.select).not.toHaveProperty("activationScript");
    expect(result?.entries.map(({ id }) => id)).toEqual(["entry-a", "entry-b"]);
    expect(result?.characters.map(({ id }) => id)).toEqual(["character-a", "character-b"]);
    expect(result?.characters).toHaveLength(2);
  });

  it("preserves owner display overrides on attached character summaries", async () => {
    const record = detailRecord();
    record.characters[0].character.nameOverride = "Local display name";
    record.characters[0].character.avatarUrlOverride = "/local-avatar.webp";
    const findFirst = vi.fn().mockResolvedValue(record);

    const result = await getLorebookById(
      "lorebook-1",
      TEST_ADMIN_PRINCIPAL,
      { lorebook: { findFirst } } as unknown as PrismaClient,
    );

    expect(result?.characters.find(({ id }) => id === "character-b")).toMatchObject({
      name: "Local display name",
      avatarUrl: "/local-avatar.webp",
    });
  });

  it("returns null for a missing lorebook", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(getLorebookById(
      "missing",
      TEST_ADMIN_PRINCIPAL,
      { lorebook: { findFirst } } as unknown as PrismaClient,
    )).resolves.toBeNull();
  });

  it("filters MEMBER detail and attached characters to ACTIVE visibility", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await getLorebookById("lorebook-1", TEST_MEMBER_PRINCIPAL, { lorebook: { findFirst } } as unknown as PrismaClient);
    const query = findFirst.mock.calls[0]?.[0];
    expect(query.where).toEqual({
      id: "lorebook-1",
      characters: { some: { character: { status: "ACTIVE", publishedAt: { not: null } } } },
    });
    expect(query.select.characters.where).toEqual({
      character: { status: "ACTIVE", publishedAt: { not: null } },
    });
  });
});

function detailRecord() {
  return {
    id: "lorebook-1",
    externalId: "external-lorebook-1",
    title: "Archive Places",
    description: "Locations used by the cast.",
    sourcePlatform: "JANITOR_AI" as const,
    sourceUrl: "https://example.com/lorebooks/1",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    lastSyncedAt: new Date("2026-08-11T00:00:00.000Z"),
    _count: { entries: 2, characters: 2 },
    entries: [
      entry("entry-b", 2),
      entry("entry-a", 1),
    ],
    characters: [
      { character: character("character-b", "Beta") },
      { character: character("character-a", "Alpha") },
    ],
  };
}

function entry(id: string, insertionOrder: number) {
  return {
    id,
    externalEntryId: `external-${id}`,
    content: `${id} content`,
    keys: [id],
    category: "Place",
    comment: null,
    caseSensitive: null,
    activationMode: "keyword",
    groupWeight: null,
    enabled: true,
    constant: false,
    insertionOrder,
  };
}

function character(id: string, name: string) {
  return {
    id,
    name,
    nameOverride: null as string | null,
    avatarUrl: `/${id}.webp`,
    avatarUrlOverride: null as string | null,
    status: "ACTIVE" as const,
    sources: [{
      platform: "JANITOR_AI" as const,
      creatorName: "Fixture creator",
      sourceUrl: `https://example.com/characters/${id}`,
    }],
  };
}
