import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import {
  CHARACTER_BROWSE_STATUSES,
  CHARACTER_TAG_FACET_LIMIT,
  type CharacterBrowseAuthorScope,
  type CharacterBrowseStatus,
} from "../characters/browse";
import type { PersistedSourcePlatform } from "../sources/presentation";
import {
  AUTHOR_DEFAULT_PAGE_SIZE,
  AUTHOR_MAX_PAGE_SIZE,
} from "./constants";

export {
  AUTHOR_DEFAULT_PAGE_SIZE,
  AUTHOR_MAX_PAGE_SIZE,
} from "./constants";

export type AuthorBrowseSort = "name-asc" | "name-desc" | "characters-desc" | "recent";

type AuthorGroupOrderBy =
  | { _max: { creatorName: "asc" | "desc" } }
  | { _max: { firstSeenAt: "desc" } }
  | { _max: { lastSuccessfulSyncAt: "desc" } }
  | { _count: { characterId: "desc" } }
  | { platform: "asc" }
  | { externalCreatorId: "asc" };

export interface AuthorBrowseInput {
  query: string;
  sort: AuthorBrowseSort;
  page: number;
  pageSize: number;
}

export interface AuthorListItem {
  platform: PersistedSourcePlatform;
  externalCreatorId: string;
  creatorName: string | null;
  characterCount: number;
  latestArchiveActivityAt: Date | null;
}

export interface AuthorBrowseResult {
  items: AuthorListItem[];
  pagination: {
    page: number;
    pageSize: number;
    hasPrevious: boolean;
    hasNext: boolean;
  };
}

export interface AuthorSummary {
  platform: PersistedSourcePlatform;
  externalCreatorId: string;
  creatorName: string | null;
}

export interface AuthorCharacterFacets {
  total: number;
  statuses: Array<{ value: CharacterBrowseStatus; label: string; count: number }>;
  tags: Array<{ value: string; label: string; count: number }>;
}

export async function browseAuthors(
  input: AuthorBrowseInput,
  client?: PrismaClient,
): Promise<AuthorBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const groups = await database.characterSource.groupBy({
    by: ["platform", "externalCreatorId"],
    where: authorBrowseWhere(input.query),
    orderBy: authorBrowseOrderBy(input.sort),
    skip: (page - 1) * pageSize,
    take: pageSize + 1,
    _count: { characterId: true },
    _max: {
      creatorName: true,
      firstSeenAt: true,
      lastSuccessfulSyncAt: true,
    },
  });
  const hasNext = groups.length > pageSize;

  return {
    items: groups.slice(0, pageSize).flatMap((group) => {
      if (!group.externalCreatorId) return [];
      return [{
        platform: group.platform,
        externalCreatorId: group.externalCreatorId,
        creatorName: group._max.creatorName,
        characterCount: group._count.characterId,
        latestArchiveActivityAt: group._max.lastSuccessfulSyncAt ?? group._max.firstSeenAt,
      }];
    }),
    pagination: {
      page,
      pageSize,
      hasPrevious: page > 1,
      hasNext,
    },
  };
}

export async function getAuthorSummary(
  author: CharacterBrowseAuthorScope,
  client?: PrismaClient,
): Promise<AuthorSummary | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const source = await database.characterSource.findFirst({
    where: author,
    orderBy: [
      { lastSuccessfulSyncAt: { sort: "desc", nulls: "last" } },
      { firstSeenAt: "desc" },
      { id: "desc" },
    ],
    select: {
      platform: true,
      externalCreatorId: true,
      creatorName: true,
    },
  });
  if (!source?.externalCreatorId) return null;
  return {
    platform: source.platform,
    externalCreatorId: source.externalCreatorId,
    creatorName: source.creatorName,
  };
}

export async function getAuthorCharacterFacets(
  author: CharacterBrowseAuthorScope,
  client?: PrismaClient,
): Promise<AuthorCharacterFacets> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const visibleAuthorCharacters: Prisma.CharacterWhereInput = {
    status: { not: "DELETED" },
    sources: { some: author },
  };
  const [statusGroups, tags] = await Promise.all([
    database.character.groupBy({
      by: ["status"],
      where: visibleAuthorCharacters,
      _count: { id: true },
    }),
    database.tag.findMany({
      where: {
        characters: {
          some: { character: visibleAuthorCharacters },
        },
      },
      orderBy: [
        { characters: { _count: "desc" } },
        { name: "asc" },
      ],
      take: CHARACTER_TAG_FACET_LIMIT,
      select: {
        name: true,
        slug: true,
        _count: {
          select: {
            characters: {
              where: { character: visibleAuthorCharacters },
            },
          },
        },
      },
    }),
  ]);
  const statusCounts = new Map(statusGroups.map((group) => [group.status, group._count.id]));

  return {
    total: statusGroups.reduce((total, group) => total + group._count.id, 0),
    statuses: CHARACTER_BROWSE_STATUSES.map((status) => ({
      value: status,
      label: formatEnumLabel(status),
      count: statusCounts.get(status) ?? 0,
    })),
    tags: tags.map((tag) => ({
      value: tag.slug,
      label: tag.name,
      count: tag._count.characters,
    })),
  };
}

export function authorBrowseWhere(query: string): Prisma.CharacterSourceWhereInput {
  const trimmed = query.trim();
  return {
    externalCreatorId: { not: null },
    AND: [
      { externalCreatorId: { not: "" } },
      { character: { status: { not: "DELETED" } } },
      ...(trimmed ? [{ creatorName: { contains: trimmed, mode: "insensitive" as const } }] : []),
    ],
  };
}

export function authorBrowseOrderBy(
  sort: AuthorBrowseSort,
): AuthorGroupOrderBy[] {
  const identityOrder: AuthorGroupOrderBy[] = [
    { platform: "asc" },
    { externalCreatorId: "asc" },
  ];
  switch (sort) {
    case "name-desc": return [{ _max: { creatorName: "desc" } }, ...identityOrder];
    case "characters-desc": return [{ _count: { characterId: "desc" } }, { _max: { creatorName: "asc" } }, ...identityOrder];
    case "recent": return [{ _max: { lastSuccessfulSyncAt: "desc" } }, { _max: { firstSeenAt: "desc" } }, ...identityOrder];
    default: return [{ _max: { creatorName: "asc" } }, ...identityOrder];
  }
}

function normalizePage(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function normalizePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return AUTHOR_DEFAULT_PAGE_SIZE;
  return Math.min(value, AUTHOR_MAX_PAGE_SIZE);
}

function formatEnumLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase());
}
