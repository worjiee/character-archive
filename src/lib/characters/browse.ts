import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import {
  getSourceIdentity,
  PERSISTED_SOURCE_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../sources/presentation";

export const CHARACTER_DEFAULT_PAGE_SIZE = 30;
export const CHARACTER_MAX_PAGE_SIZE = 60;
export const CHARACTER_TAG_FACET_LIMIT = 100;
export const CHARACTER_BROWSE_STATUSES = ["ACTIVE", "QUARANTINED", "BLOCKED"] as const;

export type CharacterBrowseStatus = (typeof CHARACTER_BROWSE_STATUSES)[number];
export type CharacterBrowseSort = "updated" | "newest" | "oldest" | "name-asc" | "name-desc";

export interface CharacterBrowseInput {
  query: string;
  sources: PersistedSourcePlatform[];
  tags: string[];
  statuses: CharacterBrowseStatus[];
  sort: CharacterBrowseSort;
  page: number;
  pageSize: number;
}

export interface CharacterCardItem {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: CharacterBrowseStatus;
  sources: Array<{
    platform: PersistedSourcePlatform;
    creatorName: string | null;
  }>;
  tags: Array<{ name: string; slug: string }>;
}

export interface CharacterQuickViewData {
  id: string;
  name: string;
  avatarUrl: string | null;
  status: CharacterBrowseStatus;
  description: string | null;
  updatedAt: string;
  sources: Array<{
    platform: PersistedSourcePlatform;
    creatorName: string | null;
    sourceUrl: string;
  }>;
  tags: Array<{ name: string; slug: string }>;
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
  tags: Array<{ value: string; label: string; count: number }>;
}

export async function browseCharacters(
  input: CharacterBrowseInput,
  client?: PrismaClient,
): Promise<CharacterBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const where = characterBrowseWhere(input);
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
      avatarUrl: record.avatarUrlOverride ?? record.avatarUrl,
      status: record.status as CharacterBrowseStatus,
      sources: record.sources,
      tags: record.tags.map(({ tag }) => tag),
    })),
    pagination: pageMetadata(page, pageSize, totalItems),
  };
}

export async function getCharacterBrowseFacets(client?: PrismaClient): Promise<CharacterBrowseFacets> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const visible = { status: { not: "DELETED" as const } };
  const [statusGroups, tagRecords, ...sourceCounts] = await Promise.all([
    database.character.groupBy({
      by: ["status"],
      where: visible,
      _count: { id: true },
    }),
    database.tag.findMany({
      where: { characters: { some: { character: visible } } },
      orderBy: [{ characters: { _count: "desc" } }, { name: "asc" }],
      take: CHARACTER_TAG_FACET_LIMIT,
      select: {
        name: true,
        slug: true,
        _count: { select: { characters: { where: { character: visible } } } },
      },
    }),
    ...PERSISTED_SOURCE_PLATFORM_KEYS.map((platform) => database.character.count({
      where: { ...visible, sources: { some: { platform } } },
    })),
  ]);

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
    tags: tagRecords.map((tag) => ({
      value: tag.slug,
      label: tag.name,
      count: tag._count.characters,
    })),
  };
}

export async function getCharacterQuickView(
  id: string,
  client?: PrismaClient,
): Promise<CharacterQuickViewData | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const record = await database.character.findFirst({
    where: { id, status: { not: "DELETED" } },
    select: {
      id: true,
      name: true,
      nameOverride: true,
      avatarUrl: true,
      avatarUrlOverride: true,
      description: true,
      descriptionOverride: true,
      status: true,
      updatedAt: true,
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
  if (!record) return null;
  return {
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: record.avatarUrlOverride ?? record.avatarUrl,
    description: record.descriptionOverride ?? record.description,
    status: record.status as CharacterBrowseStatus,
    updatedAt: record.updatedAt.toISOString(),
    sources: record.sources,
    tags: record.tags.map(({ tag }) => tag),
  };
}

export function characterBrowseWhere(input: CharacterBrowseInput): Prisma.CharacterWhereInput {
  const conditions: Prisma.CharacterWhereInput[] = [{ status: { not: "DELETED" } }];
  const query = input.query.trim();
  if (query) {
    conditions.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { nameOverride: { contains: query, mode: "insensitive" } },
        { sources: { some: { creatorName: { contains: query, mode: "insensitive" } } } },
      ],
    });
  }
  if (input.sources.length > 0) conditions.push({ sources: { some: { platform: { in: input.sources } } } });
  if (input.tags.length > 0) conditions.push({ tags: { some: { tag: { slug: { in: input.tags } } } } });
  if (input.statuses.length > 0) conditions.push({ status: { in: input.statuses } });
  return { AND: conditions };
}

export function characterBrowseOrderBy(sort: CharacterBrowseSort): Prisma.CharacterOrderByWithRelationInput[] {
  switch (sort) {
    case "newest": return [{ createdAt: "desc" }, { id: "desc" }];
    case "oldest": return [{ createdAt: "asc" }, { id: "asc" }];
    case "name-asc": return [{ name: "asc" }, { id: "asc" }];
    case "name-desc": return [{ name: "desc" }, { id: "desc" }];
    default: return [{ updatedAt: "desc" }, { id: "desc" }];
  }
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
