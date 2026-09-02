import type { PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../auth";
import { normalizeSourceProse } from "../source-prose";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export interface CharacterDetail {
  id: string;
  name: string;
  avatarUrl: string | null;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  uploaderName: string;
  status: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
  sources: Array<{
    platform: "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";
    creatorName: string | null;
    sourceUrl: string;
    addedBy: string;
  }>;
  tags: Array<{ name: string; slug: string }>;
  personality: string | null;
  scenario: string | null;
  exampleDialogs: string | null;
  blockedReason: string | null;
  sourceFields: {
    name: string;
    description: string | null;
    personality: string | null;
    scenario: string | null;
    avatarUrl: string | null;
  };
  hasLocalOverrides: boolean;
  greetings: Array<{
    id: string;
    content: string;
    position: number;
    localPosition: number | null;
    hidden: boolean;
    source: {
      platform: "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";
      creatorName: string | null;
    };
  }>;
  lorebooks: Array<{
    id: string;
    title: string;
    externalId: string;
    sourcePlatform: "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";
    sourceUrl: string;
    description: string | null;
    entries: Array<{
      id: string;
      externalEntryId: string;
      content: string;
      keys: string[];
      category: string | null;
      comment: string | null;
      enabled: boolean;
      constant: boolean;
      insertionOrder: number;
    }>;
  }>;
}

export interface DeletedCharacterListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  statusBeforeDelete: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED" | null;
  updatedAt: string;
}

export async function getCharacterById(
  id: string,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterDetail | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const record = await database.character.findFirst({
    where: { AND: [{ id }, visibleCharacterWhere(principal)] },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      nameOverride: true,
      descriptionOverride: true,
      personalityOverride: true,
      scenarioOverride: true,
      avatarUrlOverride: true,
      artworkSha256: true,
      status: true,
      description: true,
      personality: true,
      scenario: true,
      exampleDialogs: true,
      blockedReason: true,
      createdAt: true,
      updatedAt: true,
      publishedAt: true,
      firstAddedBy: {
        select: { displayName: true, username: true },
      },
      sources: {
        orderBy: { firstSeenAt: "asc" },
        select: {
          platform: true,
          creatorName: true,
          sourceUrl: true,
          firstAddedBy: { select: { displayName: true, username: true } },
        },
      },
      greetings: {
        where: principal.role === "MEMBER" ? { hidden: false } : undefined,
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          content: true,
          position: true,
          localPosition: true,
          hidden: true,
          characterSource: {
            select: { platform: true, creatorName: true },
          },
        },
      },
      tags: {
        orderBy: { tag: { name: "asc" } },
        select: { tag: { select: { name: true, slug: true } } },
      },
      lorebooks: {
        orderBy: { lorebook: { title: "asc" } },
        select: {
          lorebook: {
            select: {
              id: true,
              title: true,
              externalId: true,
              sourcePlatform: true,
              sourceUrl: true,
              description: true,
              entries: {
                orderBy: [{ insertionOrder: "asc" }, { id: "asc" }],
                select: {
                  id: true,
                  externalEntryId: true,
                  content: true,
                  keys: true,
                  category: true,
                  comment: true,
                  enabled: true,
                  constant: true,
                  insertionOrder: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!record) return null;

  const greetings = [...record.greetings].sort((a, b) =>
    (a.localPosition ?? a.position) - (b.localPosition ?? b.position) || a.id.localeCompare(b.id));
  return {
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: resolveCharacterArtworkUrl(record),
    status: record.status,
    sources: record.sources.map(({ firstAddedBy, ...source }) => ({
      ...source,
      addedBy: firstAddedBy.displayName ?? firstAddedBy.username,
    })),
    description: normalizeSourceProse(record.descriptionOverride ?? record.description),
    personality: normalizeSourceProse(record.personalityOverride ?? record.personality),
    scenario: normalizeSourceProse(record.scenarioOverride ?? record.scenario),
    exampleDialogs: normalizeSourceProse(record.exampleDialogs),
    blockedReason: record.blockedReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    publishedAt: record.publishedAt,
    uploaderName: record.firstAddedBy.displayName ?? record.firstAddedBy.username,
    sourceFields: {
      name: record.name,
      description: normalizeSourceProse(record.description),
      personality: normalizeSourceProse(record.personality),
      scenario: normalizeSourceProse(record.scenario),
      avatarUrl: record.avatarUrl,
    },
    hasLocalOverrides: [
      record.nameOverride,
      record.descriptionOverride,
      record.personalityOverride,
      record.scenarioOverride,
      record.avatarUrlOverride,
    ].some((value) => value !== null),
    greetings: greetings.map(({ characterSource, ...greeting }) => ({
      ...greeting,
      content: normalizeSourceProse(greeting.content) ?? "",
      source: characterSource,
    })),
    tags: record.tags.map(({ tag }) => tag),
    lorebooks: record.lorebooks.map(({ lorebook }) => lorebook),
  };
}

export async function listDeletedCharacters(client?: PrismaClient): Promise<DeletedCharacterListItem[]> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const records = await database.character.findMany({
    where: { status: "DELETED" },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      nameOverride: true,
      avatarUrl: true,
      avatarUrlOverride: true,
      artworkSha256: true,
      statusBeforeDelete: true,
      updatedAt: true,
    },
  });
  return records.map((record) => ({
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: resolveCharacterArtworkUrl(record),
    statusBeforeDelete: record.statusBeforeDelete,
    updatedAt: record.updatedAt.toISOString(),
  }));
}
