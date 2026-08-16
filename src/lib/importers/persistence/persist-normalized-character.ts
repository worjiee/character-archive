import { Prisma, type PrismaClient } from "../../../../generated/prisma/client";
import type {
  NormalizedCharacter,
  NormalizedGreeting,
  NormalizedLorebookReference,
  NormalizedTag,
} from "../types";
import {
  evaluatePersistedCharacter,
  type ModerationSaveResult,
} from "../../moderation/service";

export interface PersistNormalizedCharacterOptions {
  client?: PrismaClient;
  now?: () => Date;
}

export interface PersistNormalizedCharacterResult extends ModerationSaveResult {
  characterId: string;
  characterSourceId: string;
}

export async function persistNormalizedCharacter(
  character: NormalizedCharacter,
  options: PersistNormalizedCharacterOptions = {},
): Promise<PersistNormalizedCharacterResult> {
  const client = options.client ?? (await import("../../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const rawData = toPrismaJson(character.rawData);
  const greetings = uniqueGreetings(character.greetings);
  const tags = uniqueBy(character.tags, (tag) => tag.slug);
  const lorebookReferences = uniqueBy(
    character.lorebookReferences,
    (reference) => reference.externalId,
  );
  const characterFields = {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    exampleDialogs: character.exampleDialogs,
    avatarUrl: character.avatarUrl,
    lastCheckedAt: now,
  };

  return client.$transaction(
    async (tx) => {
      const source = await tx.characterSource.upsert({
        where: {
          platform_externalId: {
            platform: character.platform,
            externalId: character.externalId,
          },
        },
        update: {
          sourceUrl: character.sourceUrl,
          externalCreatorId: character.creator.externalId,
          creatorName: character.creator.name,
          rawData,
          lastSyncedAt: now,
          lastSuccessfulSyncAt: now,
          character: { update: characterFields },
        },
        create: {
          platform: character.platform,
          externalId: character.externalId,
          sourceUrl: character.sourceUrl,
          externalCreatorId: character.creator.externalId,
          creatorName: character.creator.name,
          rawData,
          firstSeenAt: now,
          lastSyncedAt: now,
          lastSuccessfulSyncAt: now,
          character: { create: characterFields },
        },
        select: { id: true, characterId: true },
      });

      await synchronizeGreetings(tx, source, greetings);
      await synchronizeTags(tx, source.characterId, tags);
      await synchronizeLorebooks(
        tx,
        source.characterId,
        character.platform,
        character.sourceUrl,
        lorebookReferences,
        now,
      );
      const moderation = await evaluatePersistedCharacter(tx, source.characterId);

      return {
        characterId: source.characterId,
        characterSourceId: source.id,
        ...moderation,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function synchronizeGreetings(
  tx: Prisma.TransactionClient,
  source: { id: string; characterId: string },
  greetings: NormalizedGreeting[],
): Promise<void> {
  const existing = await tx.greeting.findMany({
    where: { characterSourceId: source.id },
    select: { id: true, content: true },
  });
  const existingByContent = new Map(existing.map((greeting) => [greeting.content, greeting]));
  const retainedIds: string[] = [];
  const newGreetings: Array<{ content: string; position: number }> = [];

  for (const [position, greeting] of greetings.entries()) {
    const current = existingByContent.get(greeting.content);
    if (current) {
      retainedIds.push(current.id);
      await tx.greeting.update({ where: { id: current.id }, data: { position } });
    } else {
      newGreetings.push({ content: greeting.content, position });
    }
  }

  await tx.greeting.deleteMany({
    where: { characterSourceId: source.id, id: { notIn: retainedIds } },
  });

  if (newGreetings.length === 0) return;
  await tx.greeting.createMany({
    data: newGreetings.map((greeting) => ({
      characterId: source.characterId,
      characterSourceId: source.id,
      content: greeting.content,
      position: greeting.position,
    })),
  });
}

async function synchronizeTags(
  tx: Prisma.TransactionClient,
  characterId: string,
  tags: NormalizedTag[],
): Promise<void> {
  const tagIds: string[] = [];

  for (const tag of tags) {
    const record = await tx.tag.upsert({
      where: { slug: tag.slug },
      update: { name: tag.name },
      create: { name: tag.name, slug: tag.slug },
      select: { id: true },
    });
    tagIds.push(record.id);
  }

  await tx.characterTag.deleteMany({ where: { characterId } });

  if (tagIds.length === 0) return;

  await tx.characterTag.createMany({
    data: tagIds.map((tagId) => ({ characterId, tagId })),
    skipDuplicates: true,
  });
}

async function synchronizeLorebooks(
  tx: Prisma.TransactionClient,
  characterId: string,
  platform: NormalizedCharacter["platform"],
  characterSourceUrl: string,
  references: NormalizedLorebookReference[],
  now: Date,
): Promise<void> {
  const lorebookIds: string[] = [];

  for (const reference of references) {
    const sourceUrl = buildLorebookReferenceUrl(characterSourceUrl, reference.externalId);
    const record = await tx.lorebook.upsert({
      where: {
        sourcePlatform_externalId: {
          sourcePlatform: platform,
          externalId: reference.externalId,
        },
      },
      update: {
        title: reference.title,
        sourceUrl,
        lastSyncedAt: now,
      },
      create: {
        title: reference.title,
        externalId: reference.externalId,
        sourcePlatform: platform,
        sourceUrl,
        lastSyncedAt: now,
      },
      select: { id: true },
    });
    lorebookIds.push(record.id);
  }

  await tx.characterLorebook.deleteMany({
    where: {
      characterId,
      lorebook: { sourcePlatform: platform },
    },
  });

  if (lorebookIds.length === 0) return;

  await tx.characterLorebook.createMany({
    data: lorebookIds.map((lorebookId) => ({ characterId, lorebookId })),
    skipDuplicates: true,
  });
}

function uniqueGreetings(greetings: NormalizedGreeting[]): NormalizedGreeting[] {
  return uniqueBy(greetings, (greeting) => greeting.content);
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const keys = new Set<string>();

  return items.filter((item) => {
    const key = getKey(item);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function buildLorebookReferenceUrl(characterSourceUrl: string, externalId: string): string {
  return `${characterSourceUrl.split("#", 1)[0]}#lorebook-${encodeURIComponent(externalId)}`;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;

  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Normalized character rawData must be JSON-serializable.");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}
