import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import {
  getSourceIdentity,
  PERSISTED_SOURCE_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../sources/presentation";
import type { LorebookListItem } from "./repository";

export const LOREBOOK_DEFAULT_PAGE_SIZE = 30;
export const LOREBOOK_MAX_PAGE_SIZE = 60;

export type LorebookBrowseSort = "updated" | "newest" | "oldest" | "title-asc" | "title-desc";

export interface LorebookBrowseInput {
  query: string;
  sources: PersistedSourcePlatform[];
  sort: LorebookBrowseSort;
  page: number;
  pageSize: number;
}

export interface LorebookBrowseResult {
  items: LorebookListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}

export interface LorebookBrowseFacets {
  total: number;
  sources: Array<{ value: PersistedSourcePlatform; label: string; count: number }>;
}

export async function browseLorebooks(
  input: LorebookBrowseInput,
  client?: PrismaClient,
): Promise<LorebookBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const where = lorebookBrowseWhere(input);
  const [records, totalItems] = await Promise.all([
    database.lorebook.findMany({
      where,
      orderBy: lorebookBrowseOrderBy(input.sort),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        externalId: true,
        title: true,
        description: true,
        sourcePlatform: true,
        sourceUrl: true,
        createdAt: true,
        updatedAt: true,
        lastSyncedAt: true,
        _count: { select: { entries: true, characters: true } },
      },
    }),
    database.lorebook.count({ where }),
  ]);
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    items: records.map(({ _count, ...record }) => ({
      ...record,
      entryCount: _count.entries,
      characterCount: _count.characters,
    })),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasPrevious: page > 1,
      hasNext: page < totalPages,
    },
  };
}

export async function getLorebookBrowseFacets(client?: PrismaClient): Promise<LorebookBrowseFacets> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const groups = await database.lorebook.groupBy({
    by: ["sourcePlatform"],
    _count: { id: true },
  });
  const counts = new Map(groups.map((group) => [group.sourcePlatform, group._count.id]));
  return {
    total: groups.reduce((total, group) => total + group._count.id, 0),
    sources: PERSISTED_SOURCE_PLATFORM_KEYS.map((platform) => ({
      value: platform,
      label: getSourceIdentity(platform).label,
      count: counts.get(platform) ?? 0,
    })),
  };
}

export function lorebookBrowseWhere(input: LorebookBrowseInput): Prisma.LorebookWhereInput {
  const where: Prisma.LorebookWhereInput = {};
  const query = input.query.trim();
  if (query) {
    where.OR = [
      { title: { contains: query, mode: "insensitive" } },
      { description: { contains: query, mode: "insensitive" } },
    ];
  }
  if (input.sources.length > 0) where.sourcePlatform = { in: input.sources };
  return where;
}

export function lorebookBrowseOrderBy(sort: LorebookBrowseSort): Prisma.LorebookOrderByWithRelationInput[] {
  switch (sort) {
    case "newest": return [{ createdAt: "desc" }, { id: "desc" }];
    case "oldest": return [{ createdAt: "asc" }, { id: "asc" }];
    case "title-asc": return [{ title: "asc" }, { id: "asc" }];
    case "title-desc": return [{ title: "desc" }, { id: "desc" }];
    default: return [{ updatedAt: "desc" }, { id: "desc" }];
  }
}

function normalizePage(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function normalizePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return LOREBOOK_DEFAULT_PAGE_SIZE;
  return Math.min(value, LOREBOOK_MAX_PAGE_SIZE);
}
