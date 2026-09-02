import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../auth";
import {
  getSourceIdentity,
  PERSISTED_SOURCE_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../sources/presentation";
import type { TagVocabularySource } from "../tags/contracts";
import { normalizeSourceProse } from "../source-prose";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export const CHARACTER_DEFAULT_PAGE_SIZE = 30;
export const CHARACTER_MAX_PAGE_SIZE = 60;
export const CHARACTER_QUICK_VIEW_TAG_LIMIT = 6;
export const CHARACTER_QUICK_VIEW_SOURCE_LIMIT = 6;
export const CHARACTER_QUICK_VIEW_GREETING_LIMIT = 1;
export const CHARACTER_QUICK_VIEW_LOREBOOK_LIMIT = 4;
export const CHARACTER_BROWSE_STATUSES = ["ACTIVE", "QUARANTINED", "BLOCKED"] as const;

export type CharacterBrowseStatus = (typeof CHARACTER_BROWSE_STATUSES)[number];
export type CharacterBrowseSort =
  | "updated"
  | "updated-oldest"
  | "newest"
  | "oldest"
  | "name-asc"
  | "name-desc"
  | "archive_updated_newest"
  | "archive_added_newest"
  | "archive_added_oldest"
  | "name_asc"
  | "name_desc";

export interface CharacterBrowseInput {
  query: string;
  sources: PersistedSourcePlatform[];
  tags: string[];
  tagSource: TagVocabularySource;
  statuses: CharacterBrowseStatus[];
  sort: CharacterBrowseSort;
  page: number;
  pageSize: number;
  author?: CharacterBrowseAuthorScope;
}

export interface CharacterBrowseAuthorScope {
  platform: PersistedSourcePlatform;
  externalCreatorId: string;
}

export interface CharacterCardItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: CharacterBrowseStatus;
  sources: Array<{
    platform: PersistedSourcePlatform;
    creatorName: string | null;
    externalCreatorId?: string | null;
  }>;
  tags: Array<{ name: string; slug: string }>;
}

export interface CharacterQuickViewData {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: CharacterBrowseStatus;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  exampleDialogs: string | null;
  updatedAt: string;
  publishedAt: string | null;
  uploaderName: string;
  sources: Array<{
    platform: PersistedSourcePlatform;
    creatorName: string | null;
    sourceUrl: string;
    addedBy: string;
  }>;
  sourceCount: number;
  tags: Array<{ name: string; slug: string }>;
  tagCount: number;
  greetingCount: number;
  greetingPreview: {
    id: string;
    content: string;
    source: {
      platform: PersistedSourcePlatform;
      creatorName: string | null;
    };
  } | null;
  lorebookCount: number;
  lorebooks: Array<{
    id: string;
    title: string;
    sourcePlatform: PersistedSourcePlatform;
  }>;
}

export interface PageMetadata {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface CharacterBrowseResult {
  items: CharacterCardItem[];
  pagination: PageMetadata;
}

export interface CharacterBrowseFacets {
  total: number;
  sources: Array<{ value: PersistedSourcePlatform; label: string; count: number }>;
  statuses: Array<{ value: CharacterBrowseStatus; label: string; count: number }>;
}

export async function browseCharacters(
  input: CharacterBrowseInput,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const where = characterBrowseWhere(input, principal);
  const orderBy = characterBrowseOrderBy(input.sort);
  const [records, totalItems] = await Promise.all([
    database.character.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        nameOverride: true,
        avatarUrl: true,
        avatarUrlOverride: true,
        artworkSha256: true,
        status: true,
        sources: {
          orderBy: { firstSeenAt: "asc" },
          select: { platform: true, creatorName: true },
        },
        tags: {
          orderBy: { tag: { name: "asc" } },
          select: { tag: { select: { name: true, slug: true } } },
        },
      },
    }),
    database.character.count({ where }),
  ]);

  return {
    items: records.map((record) => ({
      id: record.id,
      name: record.nameOverride ?? record.name,
      avatarUrl: resolveCharacterArtworkUrl(record),
      status: record.status as CharacterBrowseStatus,
      sources: record.sources,
      tags: record.tags.map(({ tag }) => tag),
    })),
    pagination: pageMetadata(page, pageSize, totalItems),
  };
}

export async function getCharacterBrowseFacets(
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterBrowseFacets> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const visible = visibleCharacterWhere(principal);
  const statusGroups = await database.character.groupBy({
    by: ["status"],
    where: visible,
    _count: { id: true },
  });
  const sourceCounts: number[] = [];
  for (const platform of PERSISTED_SOURCE_PLATFORM_KEYS) {
    sourceCounts.push(await database.character.count({
      where: { ...visible, sources: { some: { platform } } },
    }));
  }

  const statusCounts = new Map(statusGroups.map((group) => [group.status, group._count.id]));
  return {
    total: statusGroups.reduce((total, group) => total + group._count.id, 0),
    sources: PERSISTED_SOURCE_PLATFORM_KEYS.map((platform, index) => ({
      value: platform,
      label: getSourceIdentity(platform).label,
      count: sourceCounts[index] ?? 0,
    })),
    statuses: CHARACTER_BROWSE_STATUSES.map((status) => ({
      value: status,
      label: formatEnumLabel(status),
      count: statusCounts.get(status) ?? 0,
    })),
  };
}

export async function getCharacterQuickView(
  id: string,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterQuickViewData | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const record = await database.character.findFirst({
    where: { AND: [{ id }, visibleCharacterWhere(principal)] },
    select: {
      id: true,
      name: true,
      nameOverride: true,
      avatarUrl: true,
      avatarUrlOverride: true,
      artworkSha256: true,
      description: true,
      descriptionOverride: true,
      personality: true,
      personalityOverride: true,
      scenario: true,
      scenarioOverride: true,
      exampleDialogs: true,
      status: true,
      updatedAt: true,
      publishedAt: true,
      firstAddedBy: {
        select: { displayName: true, username: true },
      },
      sources: {
        orderBy: { firstSeenAt: "asc" },
        take: CHARACTER_QUICK_VIEW_SOURCE_LIMIT,
        select: {
          platform: true,
          creatorName: true,
          sourceUrl: true,
          firstAddedBy: { select: { displayName: true, username: true } },
        },
      },
      tags: {
        orderBy: { tag: { name: "asc" } },
        take: CHARACTER_QUICK_VIEW_TAG_LIMIT,
        select: { tag: { select: { name: true, slug: true } } },
      },
      greetings: {
        where: { hidden: false },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: CHARACTER_QUICK_VIEW_GREETING_LIMIT,
        select: {
          id: true,
          content: true,
          characterSource: {
            select: { platform: true, creatorName: true },
          },
        },
      },
      lorebooks: {
        orderBy: { lorebook: { title: "asc" } },
        take: CHARACTER_QUICK_VIEW_LOREBOOK_LIMIT,
        select: {
          lorebook: {
            select: { id: true, title: true, sourcePlatform: true },
          },
        },
      },
      _count: {
        select: {
          tags: true,
          sources: true,
          greetings: { where: { hidden: false } },
          lorebooks: true,
        },
      },
    },
  });
  if (!record) return null;
  return {
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: resolveCharacterArtworkUrl(record),
    description: normalizeSourceProse(record.descriptionOverride ?? record.description),
    personality: normalizeSourceProse(record.personalityOverride ?? record.personality),
    scenario: normalizeSourceProse(record.scenarioOverride ?? record.scenario),
    exampleDialogs: normalizeSourceProse(record.exampleDialogs),
    status: record.status as CharacterBrowseStatus,
    updatedAt: record.updatedAt.toISOString(),
    publishedAt: record.publishedAt?.toISOString() ?? null,
    uploaderName: record.firstAddedBy.displayName ?? record.firstAddedBy.username,
    sources: record.sources.map(({ firstAddedBy, ...source }) => ({
      ...source,
      addedBy: firstAddedBy.displayName ?? firstAddedBy.username,
    })),
    sourceCount: record._count.sources,
    tags: record.tags.map(({ tag }) => tag),
    tagCount: record._count.tags,
    greetingCount: record._count.greetings,
    greetingPreview: record.greetings[0]
      ? {
          id: record.greetings[0].id,
          content: normalizeSourceProse(record.greetings[0].content) ?? "",
          source: record.greetings[0].characterSource,
        }
      : null,
    lorebookCount: record._count.lorebooks,
    lorebooks: record.lorebooks.map(({ lorebook }) => lorebook),
  };
}

export function characterBrowseWhere(
  input: CharacterBrowseInput,
  principal?: AuthenticatedPrincipal,
): Prisma.CharacterWhereInput {
  const conditions: Prisma.CharacterWhereInput[] = [
    principal ? visibleCharacterWhere(principal) : { status: { not: "DELETED" } },
  ];
  const query = input.query.trim();
  if (query) {
    conditions.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { nameOverride: { contains: query, mode: "insensitive" } },
        ...(input.author ? [] : [{ sources: { some: { creatorName: { contains: query, mode: "insensitive" as const } } } }]),
      ],
    });
  }
  if (input.author) {
    conditions.push({
      sources: {
        some: {
          platform: input.author.platform,
          externalCreatorId: input.author.externalCreatorId,
        },
      },
    });
  }
  if (input.sources.length > 0) conditions.push({ sources: { some: { platform: { in: input.sources } } } });
  if (input.tags.length > 0) conditions.push({ tags: { some: { tag: { slug: { in: input.tags } } } } });
  if (input.statuses.length > 0) conditions.push({ status: { in: input.statuses } });
  return { AND: conditions };
}

export function characterBrowseOrderBy(sort: CharacterBrowseSort): Prisma.CharacterOrderByWithRelationInput[] {
  switch (sort) {
    case "updated-oldest": return [{ updatedAt: "asc" }, { id: "asc" }];
    case "newest":
    case "archive_added_newest": return [{ createdAt: "desc" }, { id: "desc" }];
    case "oldest":
    case "archive_added_oldest": return [{ createdAt: "asc" }, { id: "asc" }];
    case "name-asc":
    case "name_asc": return [{ name: "asc" }, { id: "asc" }];
    case "name-desc":
    case "name_desc": return [{ name: "desc" }, { id: "desc" }];
    default: return [{ updatedAt: "desc" }, { id: "desc" }];
  }
}

export const DEFERRED_SOURCE_DATE_SORTS = [
  "source_created_newest",
  "source_created_oldest",
  "source_updated_newest",
  "source_updated_oldest",
] as const;

export type DeferredSourceDateSort = (typeof DEFERRED_SOURCE_DATE_SORTS)[number];

export function isDeferredSourceDateSort(key: string): key is DeferredSourceDateSort {
  return (DEFERRED_SOURCE_DATE_SORTS as readonly string[]).includes(key);
}

function normalizePage(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function normalizePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return CHARACTER_DEFAULT_PAGE_SIZE;
  return Math.min(value, CHARACTER_MAX_PAGE_SIZE);
}

function pageMetadata(page: number, pageSize: number, totalItems: number): PageMetadata {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasPrevious: page > 1,
    hasNext: page < totalPages,
  };
}

function formatEnumLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}
