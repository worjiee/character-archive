import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import {
  CHARACTER_EXPORT_FILENAME_STEM_LIMIT,
  characterExportFilename,
  getCharacterExport,
} from "./export";

describe("normalized character JSON export", () => {
  it("uses an explicit non-deleted projection and returns local display overrides", async () => {
    const findFirst = vi.fn().mockResolvedValue(exportRecord());
    const result = await getCharacterExport(
      "character-1",
      TEST_ADMIN_PRINCIPAL,
      { character: { findFirst } } as unknown as PrismaClient,
    );

    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ id: "character-1" }, { status: { not: "DELETED" } }] },
    }));
    const select = findFirst.mock.calls[0]?.[0].select;
    expect(select).not.toHaveProperty("id");
    expect(select).not.toHaveProperty("status");
    expect(select).not.toHaveProperty("blockedReason");
    expect(select).not.toHaveProperty("rawData");
    expect(select.sources.select).not.toHaveProperty("rawData");
    expect(select.greetings.select).not.toHaveProperty("rawData");
    expect(select.lorebooks.select.lorebook.select).not.toHaveProperty("rawData");
    expect(select.lorebooks.select.lorebook.select).not.toHaveProperty("entries");
    expect(result).toMatchObject({
      schema: "character-archive.normalized-character",
      version: 1,
      character: {
        name: "Local Theron",
        description: "Local description",
        personality: "Local personality",
        scenario: "Source scenario",
        archiveCreatedAt: "2026-08-01T00:00:00.000Z",
        archiveUpdatedAt: "2026-08-20T00:00:00.000Z",
        sources: [{ creatorName: "Creator", sourceCreatedAt: "2026-07-01T00:00:00.000Z" }],
        lorebooks: [{ title: "World", externalId: "lorebook-source-1" }],
      },
    });
  });

  it("exports visible greetings in normalized local order and bounded lorebook references only", async () => {
    const findFirst = vi.fn().mockResolvedValue(exportRecord());
    const result = await getCharacterExport("character-1", TEST_ADMIN_PRINCIPAL, { character: { findFirst } } as unknown as PrismaClient);

    expect(result?.character.greetings.map(({ content, position }) => ({ content, position }))).toEqual([
      { content: "Locally first", position: 0 },
      { content: "Originally first", position: 1 },
    ]);
    expect(result?.character.lorebooks[0]).toEqual({
      title: "World",
      externalId: "lorebook-source-1",
      sourcePlatform: "DATACAT",
      sourceUrl: "https://example.com/lorebook/1",
    });
    expect(findFirst.mock.calls[0]?.[0].select.greetings.where).toEqual({ hidden: false });
  });

  it("never serializes raw payloads, credentials, sessions, or moderation internals", async () => {
    const record = {
      ...exportRecord(),
      rawData: { authorization: "Bearer secret" },
      encryptedToken: "ciphertext",
      ownerSession: { cookie: "private" },
      blockedReason: "moderation-only",
    };
    record.sources[0] = { ...record.sources[0], rawData: { cookie: "secret" } } as typeof record.sources[number];
    const findFirst = vi.fn().mockResolvedValue(record);
    const result = await getCharacterExport("character-1", TEST_ADMIN_PRINCIPAL, { character: { findFirst } } as unknown as PrismaClient);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("rawData");
    expect(serialized).not.toContain("Bearer secret");
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("ownerSession");
    expect(serialized).not.toContain("moderation-only");
  });

  it("returns null when the character is missing or deleted-hidden", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(getCharacterExport("missing", TEST_ADMIN_PRINCIPAL, { character: { findFirst } } as unknown as PrismaClient)).resolves.toBeNull();
  });

  it("limits MEMBER exports to ACTIVE characters", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await getCharacterExport("character-1", TEST_MEMBER_PRINCIPAL, { character: { findFirst } } as unknown as PrismaClient);
    expect(findFirst.mock.calls[0]?.[0].where.AND).toContainEqual({
      status: "ACTIVE",
      publishedAt: { not: null },
    });
  });
});

describe("character export filenames", () => {
  it.each([
    ["Theron | DKU edition", "theron-dku-edition.json"],
    ["  Héllö / ..\\ World  ", "hello-world.json"],
    ["CON", "character-con.json"],
    ["你好 💫", "character-export.json"],
    ["\u0000../..\\", "character-export.json"],
  ])("sanitizes %j deterministically", (name, expected) => {
    expect(characterExportFilename(name)).toBe(expected);
    expect(characterExportFilename(name)).toBe(expected);
  });

  it("bounds excessively long names", () => {
    const filename = characterExportFilename("A".repeat(500));
    expect(filename).toBe(`${"a".repeat(CHARACTER_EXPORT_FILENAME_STEM_LIMIT)}.json`);
    expect(filename.length).toBeLessThanOrEqual(CHARACTER_EXPORT_FILENAME_STEM_LIMIT + ".json".length);
  });
});

function exportRecord() {
  return {
    name: "Theron",
    nameOverride: "Local Theron",
    description: "Source description",
    descriptionOverride: "Local description",
    personality: "Source personality",
    personalityOverride: "Local personality",
    scenario: "Source scenario",
    scenarioOverride: null,
    exampleDialogs: "Example dialog",
    avatarUrl: "/source.webp",
    avatarUrlOverride: "/local.webp",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-20T00:00:00.000Z"),
    sources: [{
      platform: "JANITOR_AI" as const,
      externalId: "source-character-1",
      externalCreatorId: "creator-1",
      creatorName: "Creator",
      sourceUrl: "https://example.com/character/1",
      sourceCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
      sourceUpdatedAt: null,
    }],
    greetings: [
      {
        id: "greeting-1",
        externalId: "source-greeting-1",
        content: "Originally first",
        position: 0,
        localPosition: 1,
        characterSource: { platform: "JANITOR_AI" as const, externalId: "source-character-1" },
      },
      {
        id: "greeting-2",
        externalId: null,
        content: "Locally first",
        position: 1,
        localPosition: 0,
        characterSource: { platform: "JANITOR_AI" as const, externalId: "source-character-1" },
      },
    ],
    tags: [{ tag: { name: "Fantasy", slug: "fantasy" } }],
    lorebooks: [{ lorebook: {
      title: "World",
      externalId: "lorebook-source-1",
      sourcePlatform: "DATACAT" as const,
      sourceUrl: "https://example.com/lorebook/1",
    } }],
  };
}
