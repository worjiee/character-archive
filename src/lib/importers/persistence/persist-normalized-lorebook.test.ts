import { Prisma, type PrismaClient } from "../../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { NormalizedLorebook } from "../types";
import { persistNormalizedLorebook } from "./persist-normalized-lorebook";

const NOW = new Date("2026-08-17T15:00:00.000Z");

function lorebook(entries: NormalizedLorebook["entries"] = [entry("one", "First", 10), entry("two", "Second", 20)]): NormalizedLorebook {
  return {
    externalId: "fixture-lore-dku",
    platform: "JANITOR_AI",
    title: "DKU Locations & Clubs",
    description: "Fixture description",
    sourceUrl: "https://janitorai.com/lorebooks/fixture-lore-dku",
    entries,
    rawData: { fixture: true },
  };
}

function entry(id: string, content: string, insertionOrder: number): NormalizedLorebook["entries"][number] {
  return {
    externalEntryId: id,
    content,
    keys: [id],
    category: "Locations",
    enabled: true,
    constant: false,
    insertionOrder,
    comment: null,
    caseSensitive: false,
    activationMode: "keyword",
    activationScript: null,
    groupWeight: 50,
    rawData: { id, content },
  };
}

function databaseMock() {
  const entries = new Map<string, { content: string }>([
    ["unrelated:keep", { content: "Unrelated" }],
  ]);
  const lorebookUpsert = vi.fn(async (args: Prisma.LorebookUpsertArgs) => {
    void args;
    return { id: "lorebook-1" };
  });
  const entryDeleteMany = vi.fn(async (args: Prisma.LorebookEntryDeleteManyArgs) => {
    const rawNotIn = args.where?.externalEntryId && typeof args.where.externalEntryId === "object"
      ? args.where.externalEntryId.notIn ?? []
      : [];
    const notIn = Array.isArray(rawNotIn) ? rawNotIn : [];
    let count = 0;
    for (const key of [...entries.keys()]) {
      const [lorebookId, externalId] = key.split(":");
      if (lorebookId === args.where?.lorebookId && !notIn.includes(externalId)) {
        entries.delete(key); count += 1;
      }
    }
    return { count };
  });
  const entryUpsert = vi.fn(async (args: Prisma.LorebookEntryUpsertArgs) => {
    const key = `${args.create.lorebookId}:${args.create.externalEntryId}`;
    entries.set(key, { content: args.create.content });
    return { id: key };
  });
  const relationUpsert = vi.fn(async () => ({ characterId: "character-1", lorebookId: "lorebook-1" }));
  const tx = {
    lorebook: { upsert: lorebookUpsert },
    lorebookEntry: { deleteMany: entryDeleteMany, upsert: entryUpsert },
    characterLorebook: { upsert: relationUpsert },
  } as unknown as Prisma.TransactionClient;
  const transaction = vi.fn(async (
    callback: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: { isolationLevel?: string },
  ) => { void options; return callback(tx); });
  return {
    client: { $transaction: transaction } as unknown as PrismaClient,
    entries, lorebookUpsert, entryDeleteMany, entryUpsert, relationUpsert, transaction,
  };
}

describe("persistNormalizedLorebook", () => {
  it("creates a lorebook and its entries transactionally", async () => {
    const db = databaseMock();
    await expect(persistNormalizedLorebook(lorebook(), { client: db.client, now: () => NOW }))
      .resolves.toEqual({ lorebookId: "lorebook-1", entryCount: 2, characterId: null });
    expect(db.lorebookUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "fixture-lore-dku" } },
      create: expect.objectContaining({ title: "DKU Locations & Clubs", rawData: { fixture: true } }),
    }));
    expect(db.entryUpsert).toHaveBeenCalledTimes(2);
    expect(db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" });
  });

  it("re-imports through the same lorebook and entry upsert identities", async () => {
    const db = databaseMock();
    await persistNormalizedLorebook(lorebook([entry("one", "Original", 1)]), { client: db.client });
    await persistNormalizedLorebook(lorebook([entry("one", "Updated", 2)]), { client: db.client });
    expect(db.lorebookUpsert).toHaveBeenCalledTimes(2);
    expect(db.entryUpsert.mock.calls[1][0]).toMatchObject({
      where: { lorebookId_externalEntryId: { lorebookId: "lorebook-1", externalEntryId: "one" } },
      update: { content: "Updated", insertionOrder: 2 },
    });
  });

  it("removes stale entries only from the imported lorebook", async () => {
    const db = databaseMock();
    db.entries.set("lorebook-1:stale", { content: "Stale" });
    db.entries.set("lorebook-1:keep", { content: "Old" });
    await persistNormalizedLorebook(lorebook([entry("keep", "New", 0)]), { client: db.client });
    expect(db.entryDeleteMany).toHaveBeenCalledWith({
      where: { lorebookId: "lorebook-1", externalEntryId: { notIn: ["keep"] } },
    });
    expect(db.entries.has("lorebook-1:stale")).toBe(false);
    expect(db.entries.get("unrelated:keep")).toEqual({ content: "Unrelated" });
  });

  it("associates the lorebook to a character without duplicating the relation", async () => {
    const db = databaseMock();
    const result = await persistNormalizedLorebook(lorebook([]), {
      client: db.client,
      characterId: "character-1",
    });
    expect(result.characterId).toBe("character-1");
    expect(db.relationUpsert).toHaveBeenCalledWith({
      where: { characterId_lorebookId: { characterId: "character-1", lorebookId: "lorebook-1" } },
      update: {},
      create: { characterId: "character-1", lorebookId: "lorebook-1" },
    });
  });

  it("converges association-first and entries-later imports on the same source identity", async () => {
    const db = databaseMock();
    await persistNormalizedLorebook(lorebook([]), {
      client: db.client,
      characterId: "character-1",
    });
    await persistNormalizedLorebook(lorebook([entry("one", "Later entry", 1)]), {
      client: db.client,
    });

    expect(db.lorebookUpsert).toHaveBeenCalledTimes(2);
    expect(db.lorebookUpsert.mock.calls.map(([args]) => args.where)).toEqual([
      { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "fixture-lore-dku" } },
      { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "fixture-lore-dku" } },
    ]);
    expect(db.relationUpsert).toHaveBeenCalledTimes(1);
    expect(db.entries.get("lorebook-1:one")).toEqual({ content: "Later entry" });
  });

  it("converges entries-first and association-later imports on the same source identity", async () => {
    const db = databaseMock();
    const normalized = lorebook([entry("one", "Existing entry", 1)]);
    await persistNormalizedLorebook(normalized, { client: db.client });
    await persistNormalizedLorebook(normalized, {
      client: db.client,
      characterId: "character-1",
    });

    expect(db.lorebookUpsert).toHaveBeenCalledTimes(2);
    expect(db.lorebookUpsert.mock.calls.map(([args]) => args.where)).toEqual([
      { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "fixture-lore-dku" } },
      { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "fixture-lore-dku" } },
    ]);
    expect(db.relationUpsert).toHaveBeenCalledTimes(1);
    expect(db.entries.get("lorebook-1:one")).toEqual({ content: "Existing entry" });
  });

  it("uses platform plus external ID as identity and never title alone", async () => {
    const db = databaseMock();
    const sameTitle = "Shared title";
    await persistNormalizedLorebook({ ...lorebook([]), externalId: "source-one", title: sameTitle }, { client: db.client });
    await persistNormalizedLorebook({ ...lorebook([]), externalId: "source-two", title: sameTitle }, { client: db.client });
    await persistNormalizedLorebook({
      ...lorebook([]),
      externalId: "source-one",
      platform: "DATACAT",
      title: sameTitle,
      sourceUrl: "https://datacat.run/characters/recent/janitor/source-one",
    }, { client: db.client });

    expect(db.lorebookUpsert.mock.calls.map(([args]) => args.where)).toEqual([
      { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "source-one" } },
      { sourcePlatform_externalId: { sourcePlatform: "JANITOR_AI", externalId: "source-two" } },
      { sourcePlatform_externalId: { sourcePlatform: "DATACAT", externalId: "source-one" } },
    ]);
  });

  it("synchronizes an empty import without affecting unrelated lorebooks", async () => {
    const db = databaseMock();
    db.entries.set("lorebook-1:stale", { content: "Stale" });
    await persistNormalizedLorebook(lorebook([]), { client: db.client });
    expect(db.entryDeleteMany).toHaveBeenCalledWith({ where: { lorebookId: "lorebook-1" } });
    expect(db.entries.has("lorebook-1:stale")).toBe(false);
    expect(db.entries.has("unrelated:keep")).toBe(true);
  });
});
