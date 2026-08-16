import type { PrismaClient } from "../../../generated/prisma/client";

export interface CharacterListItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
  sources: Array<{
    platform: "JANITOR_AI" | "SAUCEPAN" | "DATACAT" | "OTHER";
    creatorName: string | null;
    sourceUrl: string;
  }>;
  tags: Array<{ name: string; slug: string }>;
}

export interface CharacterDetail extends CharacterListItem {
  description: string | null;
  personality: string | null;
  scenario: string | null;
  exampleDialogs: string | null;
  blockedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
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

export async function listCharacters(client?: PrismaClient): Promise<CharacterListItem[]> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const records = await database.character.findMany({
    where: { status: { not: "DELETED" } },
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      nameOverride: true,
      avatarUrlOverride: true,
      status: true,
      sources: {
        orderBy: { firstSeenAt: "asc" },
        select: { platform: true, creatorName: true, sourceUrl: true },
      },
      tags: {
        orderBy: { tag: { name: "asc" } },
        select: { tag: { select: { name: true, slug: true } } },
      },
    },
  });

  return records.map((record) => ({
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: record.avatarUrlOverride ?? record.avatarUrl,
    status: record.status,
    sources: record.sources,
    tags: record.tags.map(({ tag }) => tag),
  }));
}

export async function getCharacterById(id: string, client?: PrismaClient): Promise<CharacterDetail | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const record = await database.character.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      nameOverride: true,
      descriptionOverride: true,
      personalityOverride: true,
      scenarioOverride: true,
      avatarUrlOverride: true,
      status: true,
      description: true,
      personality: true,
      scenario: true,
      exampleDialogs: true,
      blockedReason: true,
      createdAt: true,
      updatedAt: true,
      sources: {
        orderBy: { firstSeenAt: "asc" },
        select: { platform: true, creatorName: true, sourceUrl: true },
      },
      greetings: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          content: true,
          position: true,
          localPosition: true,
          hidden: true,
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
    avatarUrl: record.avatarUrlOverride ?? record.avatarUrl,
    status: record.status,
    sources: record.sources,
    description: record.descriptionOverride ?? record.description,
    personality: record.personalityOverride ?? record.personality,
    scenario: record.scenarioOverride ?? record.scenario,
    exampleDialogs: record.exampleDialogs,
    blockedReason: record.blockedReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sourceFields: {
      name: record.name,
      description: record.description,
      personality: record.personality,
      scenario: record.scenario,
      avatarUrl: record.avatarUrl,
    },
    hasLocalOverrides: [
      record.nameOverride,
      record.descriptionOverride,
      record.personalityOverride,
      record.scenarioOverride,
      record.avatarUrlOverride,
    ].some((value) => value !== null),
    greetings,
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
      statusBeforeDelete: true,
      updatedAt: true,
    },
  });
  return records.map((record) => ({
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: record.avatarUrlOverride ?? record.avatarUrl,
    statusBeforeDelete: record.statusBeforeDelete,
    updatedAt: record.updatedAt.toISOString(),
  }));
}
