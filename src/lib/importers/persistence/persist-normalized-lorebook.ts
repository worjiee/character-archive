import { Prisma, type PrismaClient } from "../../../../generated/prisma/client";
import type { NormalizedLorebook, NormalizedLorebookEntry } from "../types";

export interface PersistNormalizedLorebookOptions {
  client?: PrismaClient;
  characterId?: string;
  now?: () => Date;
}

export interface PersistNormalizedLorebookResult {
  lorebookId: string;
  entryCount: number;
  characterId: string | null;
}

export async function persistNormalizedLorebook(
  lorebook: NormalizedLorebook,
  options: PersistNormalizedLorebookOptions = {},
): Promise<PersistNormalizedLorebookResult> {
  const client = options.client ?? (await import("../../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const rawData = toPrismaJson(lorebook.rawData);

  return client.$transaction(async (tx) => {
    const record = await tx.lorebook.upsert({
      where: {
        sourcePlatform_externalId: {
          sourcePlatform: lorebook.platform,
          externalId: lorebook.externalId,
        },
      },
      update: {
        title: lorebook.title,
        description: lorebook.description,
        sourceUrl: lorebook.sourceUrl,
        rawData,
        lastSyncedAt: now,
      },
      create: {
        title: lorebook.title,
        description: lorebook.description,
        externalId: lorebook.externalId,
        sourcePlatform: lorebook.platform,
        sourceUrl: lorebook.sourceUrl,
        rawData,
        lastSyncedAt: now,
      },
      select: { id: true },
    });

    const entryIds = lorebook.entries.map((entry) => entry.externalEntryId);
    await tx.lorebookEntry.deleteMany({
      where: {
        lorebookId: record.id,
        ...(entryIds.length > 0 ? { externalEntryId: { notIn: entryIds } } : {}),
      },
    });

    for (const entry of lorebook.entries) {
      await upsertEntry(tx, record.id, entry);
    }

    if (options.characterId) {
      await tx.characterLorebook.upsert({
        where: {
          characterId_lorebookId: {
            characterId: options.characterId,
            lorebookId: record.id,
          },
        },
        update: {},
        create: { characterId: options.characterId, lorebookId: record.id },
      });
    }

    return {
      lorebookId: record.id,
      entryCount: lorebook.entries.length,
      characterId: options.characterId ?? null,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function upsertEntry(
  tx: Prisma.TransactionClient,
  lorebookId: string,
  entry: NormalizedLorebookEntry,
): Promise<void> {
  const fields = {
    content: entry.content,
    keys: entry.keys,
    category: entry.category,
    comment: entry.comment,
    caseSensitive: entry.caseSensitive,
    activationMode: entry.activationMode,
    activationScript: entry.activationScript,
    groupWeight: entry.groupWeight,
    enabled: entry.enabled,
    constant: entry.constant,
    insertionOrder: entry.insertionOrder,
    rawData: toPrismaJson(entry.rawData),
  };
  await tx.lorebookEntry.upsert({
    where: { lorebookId_externalEntryId: { lorebookId, externalEntryId: entry.externalEntryId } },
    update: fields,
    create: { lorebookId, externalEntryId: entry.externalEntryId, ...fields },
  });
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Normalized lorebook rawData must be JSON-serializable.");
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}
