import { Prisma, type PrismaClient } from "../../../../generated/prisma/client";
import type {
  NormalizedCharacter,
  NormalizedGreeting,
  NormalizedTag,
} from "../types";
import {
  evaluateCharacterForPersistence,
  normalizedCharacterToFilterable,
  type ModerationSaveResult,
} from "../../moderation/service";

export const CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS = 5_000;
export const CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS = 15_000;

export class SourceLinkingError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SourceLinkingError";
    this.code = code;
    this.status = status;
  }
}

export class TargetCharacterNotFoundError extends SourceLinkingError {
  constructor(message = "Target character not found.") {
    super("TARGET_CHARACTER_NOT_FOUND", message, 404);
  }
}

export class TargetCharacterDeletedError extends SourceLinkingError {
  constructor(message = "Target character is deleted.") {
    super("TARGET_CHARACTER_DELETED", message, 404);
  }
}

export class SourceAlreadyAttachedElsewhereError extends SourceLinkingError {
  constructor(
    message = "This source is already attached to a different character.",
  ) {
    super("SOURCE_ALREADY_ATTACHED_ELSEWHERE", message, 409);
  }
}

export class LinkConflictError extends SourceLinkingError {
  constructor(
    message = "The requested source link could not be completed due to a conflict.",
  ) {
    super("LINK_CONFLICT", message, 409);
  }
}

export interface PersistNormalizedCharacterOptions {
  client?: PrismaClient;
  now?: () => Date;
  targetCharacterId?: string;
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
  const lorebookRows = lorebookReferences.map((reference) => ({
    externalId: reference.externalId,
    title: reference.title,
    sourceUrl: buildLorebookReferenceUrl(character.sourceUrl, reference.externalId),
  }));
  const characterFields = {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    exampleDialogs: character.exampleDialogs,
    avatarUrl: character.avatarUrl,
    lastCheckedAt: now,
  };
  const moderationFields = {
    ...normalizedCharacterToFilterable(character),
    greetings: greetings.map((greeting) => greeting.content),
    tags: tags.map(({ name, slug }) => ({ name, slug })),
  };

  return client.$transaction(
    async (tx) => {
      const existingSource = await tx.characterSource.findUnique({
        where: {
          platform_externalId: {
            platform: character.platform,
            externalId: character.externalId,
          },
        },
        select: {
          id: true,
          characterId: true,
          sourceCreatedAt: true,
          sourceUpdatedAt: true,
        },
      });

      let source: {
        id: string;
        characterId: string;
        character: {
          status: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
          sources: Array<{
            platform: "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";
            externalCreatorId: string | null;
            creatorName: string | null;
          }>;
        };
      };

      const targetCharacterId = options.targetCharacterId?.trim();

      if (targetCharacterId) {
        const target = await tx.character.findUnique({
          where: { id: targetCharacterId },
          select: { id: true, status: true },
        });

        if (!target) {
          throw new TargetCharacterNotFoundError("The target character could not be found.");
        }
        if (target.status === "DELETED") {
          throw new TargetCharacterDeletedError("The target character is deleted.");
        }

        if (existingSource) {
          if (existingSource.characterId !== targetCharacterId) {
            throw new SourceAlreadyAttachedElsewhereError(
              "This source is already attached to a different character in the archive.",
            );
          }
          source = await tx.characterSource.update({
            where: { id: existingSource.id },
            data: {
              sourceUrl: character.sourceUrl,
              externalCreatorId: character.creator.externalId,
              creatorName: character.creator.name,
              rawData,
              sourceCreatedAt: existingSource.sourceCreatedAt ?? character.sourceCreatedAt,
              sourceUpdatedAt: character.sourceUpdatedAt ?? existingSource.sourceUpdatedAt ?? null,
              lastSyncedAt: now,
              lastSuccessfulSyncAt: now,
            },
            select: {
              id: true,
              characterId: true,
              character: {
                select: {
                  status: true,
                  sources: {
                    select: {
                      platform: true,
                      externalCreatorId: true,
                      creatorName: true,
                    },
                  },
                },
              },
            },
          });
        } else {
          source = await tx.characterSource.create({
            data: {
              characterId: targetCharacterId,
              platform: character.platform,
              externalId: character.externalId,
              sourceUrl: character.sourceUrl,
              externalCreatorId: character.creator.externalId,
              creatorName: character.creator.name,
              rawData,
              sourceCreatedAt: character.sourceCreatedAt,
              sourceUpdatedAt: character.sourceUpdatedAt,
              firstSeenAt: now,
              lastSyncedAt: now,
              lastSuccessfulSyncAt: now,
            },
            select: {
              id: true,
              characterId: true,
              character: {
                select: {
                  status: true,
                  sources: {
                    select: {
                      platform: true,
                      externalCreatorId: true,
                      creatorName: true,
                    },
                  },
                },
              },
            },
          });
        }
      } else {
        source = await tx.characterSource.upsert({
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
            sourceCreatedAt: existingSource?.sourceCreatedAt ?? character.sourceCreatedAt,
            sourceUpdatedAt: character.sourceUpdatedAt ?? existingSource?.sourceUpdatedAt ?? null,
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
            sourceCreatedAt: character.sourceCreatedAt,
            sourceUpdatedAt: character.sourceUpdatedAt,
            firstSeenAt: now,
            lastSyncedAt: now,
            lastSuccessfulSyncAt: now,
            character: { create: characterFields },
          },
          select: {
            id: true,
            characterId: true,
            character: {
              select: {
                status: true,
                sources: {
                  select: {
                    platform: true,
                    externalCreatorId: true,
                    creatorName: true,
                  },
                },
              },
            },
          },
        });
      }

      const isMultiSource = source.character.sources.length > 1 || Boolean(targetCharacterId);
      const moderationGreetings = await synchronizeGreetings(tx, source, greetings);
      await synchronizeTags(tx, source.characterId, tags, isMultiSource);
      await synchronizeLorebooks(
        tx,
        source.characterId,
        character.platform,
        lorebookRows,
        now,
      );
      const moderation = await evaluateCharacterForPersistence(tx, {
        id: source.characterId,
        status: source.character.status,
        ...moderationFields,
        greetings: moderationGreetings,
        sources: source.character.sources,
      });

      return {
        characterId: source.characterId,
        characterSourceId: source.id,
        ...moderation,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS,
      timeout: CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS,
    },
  );
}

async function synchronizeGreetings(
  tx: Prisma.TransactionClient,
  source: { id: string; characterId: string },
  greetings: NormalizedGreeting[],
): Promise<string[]> {
  const existing = await tx.greeting.findMany({
    where: { characterId: source.characterId },
    select: { id: true, characterSourceId: true, content: true, position: true },
  });
  const sourceGreetings = existing.filter(
    (greeting) => greeting.characterSourceId === source.id,
  );
  const existingByContent = new Map(
    sourceGreetings.map((greeting) => [greeting.content, greeting]),
  );
  const retainedIds: string[] = [];
  const newGreetings: Array<{ content: string; position: number }> = [];

  for (const [position, greeting] of greetings.entries()) {
    const current = existingByContent.get(greeting.content);
    if (current) {
      retainedIds.push(current.id);
      if (current.position !== position) {
        await tx.greeting.update({ where: { id: current.id }, data: { position } });
      }
    } else {
      newGreetings.push({ content: greeting.content, position });
    }
  }

  await tx.greeting.deleteMany({
    where: { characterSourceId: source.id, id: { notIn: retainedIds } },
  });

  if (newGreetings.length > 0) {
    await tx.greeting.createMany({
      data: newGreetings.map((greeting) => ({
        characterId: source.characterId,
        characterSourceId: source.id,
        content: greeting.content,
        position: greeting.position,
      })),
    });
  }

  return [
    ...existing
      .filter((greeting) => greeting.characterSourceId !== source.id)
      .map((greeting) => greeting.content),
    ...greetings.map((greeting) => greeting.content),
  ];
}

async function synchronizeTags(
  tx: Prisma.TransactionClient,
  characterId: string,
  tags: NormalizedTag[],
  isMultiSource = false,
): Promise<void> {
  const tagIds: string[] = [];

  if (tags.length > 0) {
    await tx.tag.createMany({
      data: tags.map(({ name, slug }) => ({ name, slug })),
      skipDuplicates: true,
    });
    const records = await tx.tag.findMany({
      where: { slug: { in: tags.map((tag) => tag.slug) } },
      select: { id: true, name: true, slug: true },
    });
    const recordsBySlug = new Map(records.map((record) => [record.slug, record]));

    for (const tag of tags) {
      const record = recordsBySlug.get(tag.slug);
      if (!record) {
        throw new Error(`Tag synchronization failed for slug ${tag.slug}.`);
      }
      tagIds.push(record.id);
      if (record.name !== tag.name) {
        await tx.tag.update({ where: { id: record.id }, data: { name: tag.name } });
      }
    }
  }

  if (isMultiSource) {
    // Non-destructive union: associate incoming tags without deleting existing tags
    if (tagIds.length > 0) {
      await tx.characterTag.createMany({
        data: tagIds.map((tagId) => ({ characterId, tagId })),
        skipDuplicates: true,
      });
    }
  } else {
    // Single-source: replace
    await tx.characterTag.deleteMany({ where: { characterId } });
    if (tagIds.length > 0) {
      await tx.characterTag.createMany({
        data: tagIds.map((tagId) => ({ characterId, tagId })),
        skipDuplicates: true,
      });
    }
  }
}

async function synchronizeLorebooks(
  tx: Prisma.TransactionClient,
  characterId: string,
  platform: NormalizedCharacter["platform"],
  referenceRows: Array<{ externalId: string; title: string; sourceUrl: string }>,
  now: Date,
): Promise<void> {
  const lorebookIds: string[] = [];

  if (referenceRows.length > 0) {
    await tx.lorebook.createMany({
      data: referenceRows.map((reference) => ({
        ...reference,
        sourcePlatform: platform,
        lastSyncedAt: now,
      })),
      skipDuplicates: true,
    });
    const records = await tx.lorebook.findMany({
      where: {
        sourcePlatform: platform,
        externalId: { in: referenceRows.map((reference) => reference.externalId) },
      },
      select: { id: true, externalId: true, title: true, sourceUrl: true },
    });
    const recordsByExternalId = new Map(
      records.map((record) => [record.externalId, record]),
    );

    for (const reference of referenceRows) {
      const record = recordsByExternalId.get(reference.externalId);
      if (!record) {
        throw new Error(
          `Lorebook synchronization failed for external ID ${reference.externalId}.`,
        );
      }
      lorebookIds.push(record.id);
      if (record.title !== reference.title || record.sourceUrl !== reference.sourceUrl) {
        await tx.lorebook.update({
          where: { id: record.id },
          data: { title: reference.title, sourceUrl: reference.sourceUrl },
        });
      }
    }

    await tx.lorebook.updateMany({
      where: { id: { in: lorebookIds } },
      data: { lastSyncedAt: now },
    });
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
