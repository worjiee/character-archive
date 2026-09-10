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
import type { AuthenticatedPrincipal } from "../../auth";
import {
  canonicalNameForSourceTag,
  normalizeTagLabel,
} from "../../tags/normalization";
import { normalizeCharacterProse } from "../../source-prose";
import {
  calculateBotTokenMetrics,
  extractCcv2PromptFields,
} from "../../characters/tokens";

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
  principal: AuthenticatedPrincipal;
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
  options: PersistNormalizedCharacterOptions,
): Promise<PersistNormalizedCharacterResult> {
  const client = options.client ?? (await import("../../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  return client.$transaction(
    (tx) => persistNormalizedCharacterInTransaction(tx, character, {
      principal: options.principal,
      targetCharacterId: options.targetCharacterId,
      now,
    }),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS,
      timeout: CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS,
    },
  );
}

export async function persistNormalizedCharacterInTransaction(
  tx: Prisma.TransactionClient,
  character: NormalizedCharacter,
  options: {
    principal: AuthenticatedPrincipal;
    targetCharacterId?: string;
    now: Date;
    artworkSha256?: string;
  },
): Promise<PersistNormalizedCharacterResult> {
  character = normalizeCharacterProse(character);
  const now = options.now;
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
  const { systemPrompt, postHistoryInstructions } = extractCcv2PromptFields(character.rawData);
  const firstGreetingContent =
    greetings.find((g) => g.position === 0)?.content ?? greetings[0]?.content ?? null;
  const { tokenCount, permanentTokenCount } = calculateBotTokenMetrics({
    personality: character.personality,
    scenario: character.scenario,
    exampleDialogs: character.exampleDialogs,
    systemPrompt,
    postHistoryInstructions,
    firstGreeting: firstGreetingContent,
  });
  const characterFields = {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    exampleDialogs: character.exampleDialogs,
    avatarUrl: character.avatarUrl,
    tokenCount,
    permanentTokenCount,
    lastCheckedAt: now,
  };
  const moderationFields = {
    ...normalizedCharacterToFilterable(character),
    greetings: greetings.map((greeting) => greeting.content),
    tags: tags.map(({ name, slug }) => ({ name, slug })),
  };

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
      const isNewCharacter = !existingSource && !options.targetCharacterId?.trim();

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
              firstAddedByUserId: options.principal.userId,
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
            firstAddedBy: { connect: { id: options.principal.userId } },
            sourceUrl: character.sourceUrl,
            externalCreatorId: character.creator.externalId,
            creatorName: character.creator.name,
            rawData,
            sourceCreatedAt: character.sourceCreatedAt,
            sourceUpdatedAt: character.sourceUpdatedAt,
            firstSeenAt: now,
            lastSyncedAt: now,
            lastSuccessfulSyncAt: now,
            character: {
              create: {
                ...characterFields,
                firstAddedBy: { connect: { id: options.principal.userId } },
                publishedAt: null,
              },
            },
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

      if (options.artworkSha256) {
        const currentArtwork = await tx.character.findUnique({
          where: { id: source.characterId },
          select: { artworkSha256: true },
        });
        // A reviewed upload supplies the initial durable artwork, but exact-source
        // reimports never replace an existing durable selection implicitly.
        if (currentArtwork && currentArtwork.artworkSha256 === null) {
          await tx.character.update({
            where: { id: source.characterId },
            data: { artworkSha256: options.artworkSha256 },
          });
        }
      }

      const moderationGreetings = await synchronizeGreetings(tx, source, greetings);
      await synchronizeSourceTags(tx, source, tags);
      await persistEmbeddedLorebooks(tx, character.embeddedLorebooks ?? [], now);
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

      if (isNewCharacter && moderation.status === "ACTIVE") {
        await tx.character.update({
          where: { id: source.characterId },
          data: { publishedAt: now },
        });
      }

      return {
        characterId: source.characterId,
        characterSourceId: source.id,
        ...moderation,
      };
}

async function persistEmbeddedLorebooks(
  tx: Prisma.TransactionClient,
  lorebooks: NonNullable<NormalizedCharacter["embeddedLorebooks"]>,
  now: Date,
): Promise<void> {
  for (const lorebook of uniqueBy(lorebooks, (item) => `${item.platform}:${item.externalId}`)) {
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
        rawData: toPrismaJson(lorebook.rawData),
        lastSyncedAt: now,
      },
      create: {
        title: lorebook.title,
        description: lorebook.description,
        externalId: lorebook.externalId,
        sourcePlatform: lorebook.platform,
        sourceUrl: lorebook.sourceUrl,
        rawData: toPrismaJson(lorebook.rawData),
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
        where: {
          lorebookId_externalEntryId: {
            lorebookId: record.id,
            externalEntryId: entry.externalEntryId,
          },
        },
        update: fields,
        create: { lorebookId: record.id, externalEntryId: entry.externalEntryId, ...fields },
      });
    }
  }
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

async function synchronizeSourceTags(
  tx: Prisma.TransactionClient,
  source: { id: string; characterId: string },
  tags: NormalizedTag[],
): Promise<void> {
  const occurrences = uniqueBy(
    tags.map((tag) => ({
      externalId: tag.externalId ?? null,
      rawLabel: tag.name,
      normalizedLabel: normalizeTagLabel(tag.name),
      canonicalName: canonicalNameForSourceTag(tag.name),
      slug: tag.slug,
    })),
    (tag) => tag.normalizedLabel,
  );
  const resolved: Array<{
    tagId: string;
    rawLabel: string;
    normalizedLabel: string;
    externalId: string | null;
  }> = [];

  if (occurrences.length > 0) {
    const slugs = occurrences.map((tag) => tag.slug);
    const normalizedLabels = occurrences.map((tag) => tag.normalizedLabel);
    const canonicalNames = occurrences.map((tag) => tag.canonicalName);
    await tx.tag.createMany({
      data: occurrences.map((tag) => ({
        name: tag.canonicalName,
        slug: tag.slug,
        normalizedLabel: tag.normalizedLabel,
      })),
      skipDuplicates: true,
    });
    const records = await tx.tag.findMany({
      where: {
        OR: [
          { slug: { in: slugs } },
          { normalizedLabel: { in: normalizedLabels } },
          { name: { in: canonicalNames } },
        ],
      },
      orderBy: { id: "asc" },
      select: { id: true, name: true, slug: true, normalizedLabel: true },
    });
    const recordsBySlug = new Map(records.map((record) => [record.slug, record]));
    const recordsByName = new Map(records.map((record) => [record.name, record]));
    const recordsByNormalizedLabel = new Map<string, (typeof records)[number]>();
    for (const record of records) {
      if (!recordsByNormalizedLabel.has(record.normalizedLabel)) {
        recordsByNormalizedLabel.set(record.normalizedLabel, record);
      }
    }

    for (const occurrence of occurrences) {
      const record = recordsBySlug.get(occurrence.slug)
        ?? recordsByNormalizedLabel.get(occurrence.normalizedLabel)
        ?? recordsByName.get(occurrence.canonicalName);
      if (!record) {
        throw new Error(`Tag synchronization failed for slug ${occurrence.slug}.`);
      }
      resolved.push({
        tagId: record.id,
        rawLabel: occurrence.rawLabel,
        normalizedLabel: occurrence.normalizedLabel,
        externalId: occurrence.externalId,
      });
    }
  }

  // Authoritative replacement is scoped to this CharacterSource only.
  await tx.sourceTag.deleteMany({ where: { characterSourceId: source.id } });
  if (resolved.length > 0) {
    await tx.sourceTag.createMany({
      data: resolved.map((tag) => ({
        characterSourceId: source.id,
        ...tag,
      })),
      skipDuplicates: true,
    });
  }

  // CharacterTag remains the canonical compatibility union for browsing.
  // The repository has no independent manual/local tag mutation path, so every
  // canonical row is rebuilt from source provenance.
  const canonicalTags = await tx.sourceTag.findMany({
    where: { characterSource: { characterId: source.characterId } },
    distinct: ["tagId"],
    select: { tagId: true },
  });
  await tx.characterTag.deleteMany({ where: { characterId: source.characterId } });
  if (canonicalTags.length > 0) {
    await tx.characterTag.createMany({
      data: canonicalTags.map(({ tagId }) => ({ characterId: source.characterId, tagId })),
      skipDuplicates: true,
    });
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
