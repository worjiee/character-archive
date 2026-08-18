import { Prisma, type PrismaClient } from "../../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedCharacter } from "../types";
import {
  CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS,
  CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS,
  persistNormalizedCharacter,
} from "./persist-normalized-character";

const NOW = new Date("2026-08-17T12:00:00.000Z");

function createCharacter(overrides: Partial<NormalizedCharacter> = {}): NormalizedCharacter {
  return {
    externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    platform: "JANITOR_AI",
    sourceUrl:
      "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron",
    name: "Theron",
    description: "Description",
    personality: "Personality",
    scenario: "Scenario",
    exampleDialogs: "Example dialogue",
    avatarUrl: "https://example.com/avatar.png",
    creator: { externalId: "creator-1", name: "Creator" },
    greetings: [
      { content: "First greeting", position: 0 },
      { content: "Second greeting", position: 1 },
    ],
    tags: [
      { externalId: "tag-1", name: "Fantasy", slug: "fantasy" },
      { name: "Adventure", slug: "adventure" },
    ],
    lorebookReferences: [
      { externalId: "lore-1", title: "World guide" },
      { externalId: "lore-2", title: "Character history" },
    ],
    rawData: { source: "fixture" },
    ...overrides,
  };
}

function createDatabaseMock(options: { failTagCreateMany?: boolean; status?: string; keywordRule?: string } = {}) {
  const state = {
    character: {
      name: "Existing name",
      status: options.status ?? "ACTIVE",
    } as Record<string, unknown>,
  };
  const tagRecords = new Map<string, { id: string; name: string; slug: string }>();
  const lorebookRecords = new Map<
    string,
    { id: string; externalId: string; title: string; sourceUrl: string }
  >();
  let committed = false;

  const operations = {
    characterSourceUpsert: vi.fn(async (args: Prisma.CharacterSourceUpsertArgs) => {
      const nestedUpdate = args.update.character;
      if (nestedUpdate && "update" in nestedUpdate && nestedUpdate.update) {
        Object.assign(state.character, nestedUpdate.update);
      }
      return {
        id: "source-1",
        characterId: "character-1",
        character: {
          status: state.character.status,
          sources: [{
            platform: "JANITOR_AI",
            externalCreatorId: args.update.externalCreatorId ?? null,
            creatorName: args.update.creatorName ?? null,
          }],
        },
      };
    }),
    greetingDeleteMany: vi.fn(async () => ({ count: 0 })),
    greetingFindMany: vi.fn(async (): Promise<Array<{
      id: string;
      characterSourceId: string;
      content: string;
      position: number;
    }>> => []),
    greetingUpdate: vi.fn(async (args: Prisma.GreetingUpdateArgs) => { void args; return {}; }),
    greetingCreateMany: vi.fn(async () => ({ count: 1 })),
    tagCreateMany: vi.fn(async (args: Prisma.TagCreateManyArgs) => {
      if (options.failTagCreateMany) throw new Error("Simulated tag failure");
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      for (const row of rows) {
        if (!tagRecords.has(row.slug)) {
          tagRecords.set(row.slug, { id: `tag:${row.slug}`, name: row.name, slug: row.slug });
        }
      }
      return { count: rows.length };
    }),
    tagFindMany: vi.fn(async () => [...tagRecords.values()]),
    tagUpdate: vi.fn(async (args: Prisma.TagUpdateArgs) => {
      const record = [...tagRecords.values()].find((tag) => tag.id === args.where.id);
      if (record && typeof args.data.name === "string") record.name = args.data.name;
      return record ?? {};
    }),
    characterTagDeleteMany: vi.fn(async () => ({ count: 0 })),
    characterTagCreateMany: vi.fn(async () => ({ count: 1 })),
    lorebookCreateMany: vi.fn(async (args: Prisma.LorebookCreateManyArgs) => {
      const rows = Array.isArray(args.data) ? args.data : [args.data];
      for (const row of rows) {
        if (!lorebookRecords.has(row.externalId)) {
          lorebookRecords.set(row.externalId, {
            id: `lorebook:${row.externalId}`,
            externalId: row.externalId,
            title: row.title,
            sourceUrl: row.sourceUrl,
          });
        }
      }
      return { count: rows.length };
    }),
    lorebookFindMany: vi.fn(async () => [...lorebookRecords.values()]),
    lorebookUpdate: vi.fn(async (args: Prisma.LorebookUpdateArgs) => {
      const record = [...lorebookRecords.values()].find(
        (lorebook) => lorebook.id === args.where.id,
      );
      if (record && typeof args.data.title === "string") record.title = args.data.title;
      if (record && typeof args.data.sourceUrl === "string") {
        record.sourceUrl = args.data.sourceUrl;
      }
      return record ?? {};
    }),
    lorebookUpdateMany: vi.fn(async () => ({ count: lorebookRecords.size })),
    characterLorebookDeleteMany: vi.fn(async () => ({ count: 0 })),
    characterLorebookCreateMany: vi.fn(async () => ({ count: 1 })),
    characterUpdate: vi.fn(async (args: Prisma.CharacterUpdateArgs) => {
      Object.assign(state.character, args.data);
      return state.character;
    }),
    blockRuleFindMany: vi.fn(async () => options.keywordRule ? [{ id: "rule-1", type: "KEYWORD", value: options.keywordRule, enabled: true }] : []),
    blockedCreatorFindMany: vi.fn(async () => []),
  };

  const tx = {
    characterSource: { upsert: operations.characterSourceUpsert },
    greeting: {
      findMany: operations.greetingFindMany,
      update: operations.greetingUpdate,
      deleteMany: operations.greetingDeleteMany,
      createMany: operations.greetingCreateMany,
    },
    tag: {
      createMany: operations.tagCreateMany,
      findMany: operations.tagFindMany,
      update: operations.tagUpdate,
    },
    characterTag: {
      deleteMany: operations.characterTagDeleteMany,
      createMany: operations.characterTagCreateMany,
    },
    lorebook: {
      createMany: operations.lorebookCreateMany,
      findMany: operations.lorebookFindMany,
      update: operations.lorebookUpdate,
      updateMany: operations.lorebookUpdateMany,
    },
    characterLorebook: {
      deleteMany: operations.characterLorebookDeleteMany,
      createMany: operations.characterLorebookCreateMany,
    },
    character: { update: operations.characterUpdate },
    blockRule: { findMany: operations.blockRuleFindMany },
    blockedCreator: { findMany: operations.blockedCreatorFindMany },
  } as unknown as Prisma.TransactionClient;

  const transaction = vi.fn(
    async (
      callback: (transactionClient: Prisma.TransactionClient) => Promise<unknown>,
      transactionOptions?: { isolationLevel?: string; maxWait?: number; timeout?: number },
    ) => {
      void transactionOptions;
      const snapshot = structuredClone(state);
      try {
        const result = await callback(tx);
        committed = true;
        return result;
      } catch (error) {
        state.character = snapshot.character;
        throw error;
      }
    },
  );
  const client = { $transaction: transaction } as unknown as PrismaClient;

  return {
    client,
    operations,
    state,
    transaction,
    wasCommitted: () => committed,
  };
}

describe("persistNormalizedCharacter", () => {
  it("creates a new character through the source upsert", async () => {
    const database = createDatabaseMock();
    const character = createCharacter();

    await expect(
      persistNormalizedCharacter(character, { client: database.client, now: () => NOW }),
    ).resolves.toEqual({
      characterId: "character-1",
      characterSourceId: "source-1",
      moderation: { blocked: false, matches: [] },
      status: "ACTIVE",
      blockedReason: null,
    });

    const args = database.operations.characterSourceUpsert.mock.calls[0][0];
    expect(args.where).toEqual({
      platform_externalId: {
        platform: "JANITOR_AI",
        externalId: character.externalId,
      },
    });
    expect(args.create).toMatchObject({
      externalCreatorId: "creator-1",
      creatorName: "Creator",
      rawData: { source: "fixture" },
      firstSeenAt: NOW,
      lastSyncedAt: NOW,
      lastSuccessfulSyncAt: NOW,
      character: {
        create: {
          name: "Theron",
          description: "Description",
          lastCheckedAt: NOW,
        },
      },
    });
    expect(database.transaction.mock.calls[0][1]).toEqual({
      isolationLevel: "Serializable",
      maxWait: CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS,
      timeout: CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS,
    });
  });

  it("re-imports the same source through the same composite upsert key", async () => {
    const database = createDatabaseMock();
    const character = createCharacter();

    const first = await persistNormalizedCharacter(character, {
      client: database.client,
      now: () => NOW,
    });
    const second = await persistNormalizedCharacter(character, {
      client: database.client,
      now: () => NOW,
    });

    expect(first).toEqual(second);
    expect(database.operations.characterSourceUpsert).toHaveBeenCalledTimes(2);
    expect(database.operations.characterSourceUpsert.mock.calls[1][0].where).toEqual(
      database.operations.characterSourceUpsert.mock.calls[0][0].where,
    );
  });

  it("updates mutable character and source fields on re-import", async () => {
    const database = createDatabaseMock();
    const character = createCharacter({
      name: "Updated Theron",
      description: "Updated description",
      creator: { externalId: "creator-2", name: "Updated Creator" },
      rawData: { version: 2 },
    });

    await persistNormalizedCharacter(character, { client: database.client, now: () => NOW });

    const update = database.operations.characterSourceUpsert.mock.calls[0][0].update;
    expect(update).toMatchObject({
      externalCreatorId: "creator-2",
      creatorName: "Updated Creator",
      rawData: { version: 2 },
      lastSyncedAt: NOW,
      lastSuccessfulSyncAt: NOW,
      character: {
        update: {
          name: "Updated Theron",
          description: "Updated description",
          lastCheckedAt: NOW,
        },
      },
    });
  });

  it("replaces source greetings in order without duplicate content", async () => {
    const database = createDatabaseMock();
    const character = createCharacter({
      greetings: [
        { content: "Hello", position: 8 },
        { content: "Hello", position: 9 },
        { content: "Welcome", position: 10 },
      ],
    });

    await persistNormalizedCharacter(character, { client: database.client, now: () => NOW });

    expect(database.operations.greetingDeleteMany).toHaveBeenCalledWith({
      where: { characterSourceId: "source-1", id: { notIn: [] } },
    });
    expect(database.operations.greetingCreateMany).toHaveBeenCalledWith({
      data: [
        {
          characterId: "character-1",
          characterSourceId: "source-1",
          content: "Hello",
          position: 0,
        },
        {
          characterId: "character-1",
          characterSourceId: "source-1",
          content: "Welcome",
          position: 1,
        },
      ],
    });
  });

  it("bulk-creates tags by slug and synchronizes CharacterTag relations", async () => {
    const database = createDatabaseMock();

    await persistNormalizedCharacter(createCharacter(), {
      client: database.client,
      now: () => NOW,
    });

    expect(database.operations.tagCreateMany).toHaveBeenCalledTimes(1);
    expect(database.operations.tagCreateMany).toHaveBeenCalledWith({
      data: [
        { name: "Fantasy", slug: "fantasy" },
        { name: "Adventure", slug: "adventure" },
      ],
      skipDuplicates: true,
    });
    expect(database.operations.tagFindMany).toHaveBeenCalledTimes(1);
    expect(database.operations.characterTagDeleteMany).toHaveBeenCalledWith({
      where: { characterId: "character-1" },
    });
    expect(database.operations.characterTagCreateMany).toHaveBeenCalledWith({
      data: [
        { characterId: "character-1", tagId: "tag:fantasy" },
        { characterId: "character-1", tagId: "tag:adventure" },
      ],
      skipDuplicates: true,
    });
  });

  it("bulk-creates lorebook references and synchronizes platform relations", async () => {
    const database = createDatabaseMock();

    await persistNormalizedCharacter(createCharacter(), {
      client: database.client,
      now: () => NOW,
    });

    expect(database.operations.lorebookCreateMany).toHaveBeenCalledTimes(1);
    expect(database.operations.lorebookCreateMany).toHaveBeenCalledWith({
      data: [
        {
          externalId: "lore-1",
          title: "World guide",
          sourceUrl: expect.stringContaining("#lorebook-lore-1"),
          sourcePlatform: "JANITOR_AI",
          lastSyncedAt: NOW,
        },
        {
          externalId: "lore-2",
          title: "Character history",
          sourceUrl: expect.stringContaining("#lorebook-lore-2"),
          sourcePlatform: "JANITOR_AI",
          lastSyncedAt: NOW,
        },
      ],
      skipDuplicates: true,
    });
    expect(database.operations.lorebookFindMany).toHaveBeenCalledTimes(1);
    expect(database.operations.lorebookUpdateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["lorebook:lore-1", "lorebook:lore-2"] },
      },
      data: { lastSyncedAt: NOW },
    });
    expect(database.operations.characterLorebookDeleteMany).toHaveBeenCalledWith({
      where: {
        characterId: "character-1",
        lorebook: { sourcePlatform: "JANITOR_AI" },
      },
    });
    expect(database.operations.characterLorebookCreateMany).toHaveBeenCalledWith({
      data: [
        { characterId: "character-1", lorebookId: "lorebook:lore-1" },
        { characterId: "character-1", lorebookId: "lorebook:lore-2" },
      ],
      skipDuplicates: true,
    });
  });

  it("propagates a transaction failure and rolls back prior mocked state changes", async () => {
    const database = createDatabaseMock({ failTagCreateMany: true });

    await expect(
      persistNormalizedCharacter(createCharacter({ name: "Uncommitted name" }), {
        client: database.client,
        now: () => NOW,
      }),
    ).rejects.toThrow("Simulated tag failure");

    expect(database.wasCommitted()).toBe(false);
    expect(database.state.character.name).toBe("Existing name");
    expect(database.operations.greetingCreateMany).toHaveBeenCalled();
    expect(database.operations.lorebookCreateMany).not.toHaveBeenCalled();
  });

  it("preserves moderation status when updating an existing character", async () => {
    const database = createDatabaseMock({ status: "BLOCKED" });

    await persistNormalizedCharacter(createCharacter({ name: "Updated while blocked" }), {
      client: database.client,
      now: () => NOW,
    });

    const args = database.operations.characterSourceUpsert.mock.calls[0][0];
    expect(args.update.character).not.toHaveProperty("update.status");
    expect(args.update.character).not.toHaveProperty("update.blockedReason");
    expect(database.state.character.status).toBe("BLOCKED");
  });

  it("preserves local character and greeting overrides during source re-import", async () => {
    const database = createDatabaseMock();
    database.state.character.nameOverride = "Owner name";
    database.operations.greetingFindMany.mockResolvedValue([
      {
        id: "greeting-1",
        characterSourceId: "source-1",
        content: "First greeting",
        position: 7,
      },
    ]);

    await persistNormalizedCharacter(createCharacter({ name: "Updated source name" }), {
      client: database.client,
      now: () => NOW,
    });

    expect(database.state.character.name).toBe("Updated source name");
    expect(database.state.character.nameOverride).toBe("Owner name");
    expect(database.operations.greetingUpdate).toHaveBeenCalledWith({
      where: { id: "greeting-1" },
      data: { position: 0 },
    });
    expect(database.operations.greetingUpdate.mock.calls[0][0].data).not.toHaveProperty("hidden");
    expect(database.operations.greetingUpdate.mock.calls[0][0].data).not.toHaveProperty("localPosition");
  });

  it("does not update greeting rows whose source order is already current", async () => {
    const database = createDatabaseMock();
    database.operations.greetingFindMany.mockResolvedValue([
      {
        id: "greeting-1",
        characterSourceId: "source-1",
        content: "First greeting",
        position: 0,
      },
      {
        id: "greeting-2",
        characterSourceId: "source-1",
        content: "Second greeting",
        position: 1,
      },
    ]);

    await persistNormalizedCharacter(createCharacter(), {
      client: database.client,
      now: () => NOW,
    });

    expect(database.operations.greetingUpdate).not.toHaveBeenCalled();
    expect(database.operations.greetingCreateMany).not.toHaveBeenCalled();
  });

  it("includes greetings from another source when moderating the imported character", async () => {
    const database = createDatabaseMock({ keywordRule: "legacy warning" });
    database.operations.greetingFindMany.mockResolvedValue([
      {
        id: "other-greeting",
        characterSourceId: "source-2",
        content: "Legacy warning from another platform",
        position: 0,
      },
    ]);

    const result = await persistNormalizedCharacter(createCharacter(), {
      client: database.client,
      now: () => NOW,
    });

    expect(result.status).toBe("QUARANTINED");
    expect(result.moderation.matches[0]).toMatchObject({ matchedField: "greetings.0" });
  });

  it("quarantines a matching ACTIVE import inside the persistence transaction", async () => {
    const database = createDatabaseMock({ keywordRule: "Description" });

    const result = await persistNormalizedCharacter(createCharacter(), {
      client: database.client,
      now: () => NOW,
    });

    expect(result.status).toBe("QUARANTINED");
    expect(result.moderation.matches[0]).toMatchObject({
      ruleId: "rule-1",
      type: "KEYWORD",
      matchedField: "description",
    });
    expect(database.operations.characterUpdate).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: {
        status: "QUARANTINED",
        blockedReason: "Matched KEYWORD rule “Description” in description.",
      },
    });
  });
});
