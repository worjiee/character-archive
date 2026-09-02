import type { PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../auth";
import type { PersistedSourcePlatform } from "../sources/presentation";
import type { FreshSort, FreshWindow } from "./fresh-search";
import { normalizeSourceProse } from "../source-prose";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export { freshHref, parseFreshSearchParams } from "./fresh-search";
export type { FreshSort, FreshWindow } from "./fresh-search";

export const FRESH_CHARACTER_LIMIT = 20;
export const FRESH_TAG_LIMIT = 5;
export const FRESH_SOURCE_LIMIT = 4;
export const FRESH_ACTIVITY_LIMIT = 8;
export const FRESH_ACTIVITY_QUERY_LIMIT = 8;

export interface FreshPageInput {
  window: FreshWindow;
  sort: FreshSort;
  now?: Date;
}

export interface FreshCharacterItem {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  status: "ACTIVE" | "QUARANTINED" | "BLOCKED";
  publishedAt: string;
  uploaderName: string;
  sources: Array<{ platform: PersistedSourcePlatform; creatorName: string | null }>;
  tags: Array<{ name: string; slug: string }>;
  tagCount: number;
}

export interface FreshActivityItem {
  key: string;
  kind: "CHARACTER" | "LOREBOOK";
  label: string;
  href: string;
  action: "Added to archive" | "Updated in archive";
  occurredAt: string;
  platform: PersistedSourcePlatform | null;
}

export interface FreshPageData {
  items: FreshCharacterItem[];
  activity: FreshActivityItem[];
  generatedAt: string;
  window: FreshWindow;
  sort: FreshSort;
}

export async function getFreshPageData(
  input: FreshPageInput,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<FreshPageData> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const now = input.now ?? new Date();
  const freshSince = startForWindow(input.window, now);
  const activitySince = startForWindow("week", now);
  const direction = input.sort === "oldest" ? "asc" : "desc";
  const visible = visibleCharacterWhere(principal);

  const [characters, recentCharacters, recentLorebooks] = await Promise.all([
    database.character.findMany({
      where: {
        AND: [visible, { status: "ACTIVE", publishedAt: { gte: freshSince } }],
      },
      orderBy: [{ publishedAt: direction }, { id: direction }],
      take: FRESH_CHARACTER_LIMIT,
      select: {
        id: true,
        name: true,
        nameOverride: true,
        description: true,
        descriptionOverride: true,
        avatarUrl: true,
        avatarUrlOverride: true,
        artworkSha256: true,
        status: true,
        publishedAt: true,
        firstAddedBy: {
          select: { displayName: true, username: true },
        },
        sources: {
          orderBy: { firstSeenAt: "asc" },
          take: FRESH_SOURCE_LIMIT,
          select: { platform: true, creatorName: true },
        },
        tags: {
          orderBy: { tag: { name: "asc" } },
          take: FRESH_TAG_LIMIT,
          select: { tag: { select: { name: true, slug: true } } },
        },
        _count: { select: { tags: true } },
      },
    }),
    database.character.findMany({
      where: { AND: [visible, { updatedAt: { gte: activitySince } }] },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: FRESH_ACTIVITY_QUERY_LIMIT,
      select: {
        id: true,
        name: true,
        nameOverride: true,
        createdAt: true,
        updatedAt: true,
        sources: {
          orderBy: { firstSeenAt: "asc" },
          take: 1,
          select: { platform: true },
        },
      },
    }),
    database.lorebook.findMany({
      where: {
        updatedAt: { gte: activitySince },
        ...(principal.role === "MEMBER"
          ? { characters: { some: { character: visibleCharacterWhere(principal) } } }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: FRESH_ACTIVITY_QUERY_LIMIT,
      select: {
        id: true,
        title: true,
        sourcePlatform: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const activity = [
    ...recentCharacters.map((record): FreshActivityItem => ({
      key: `character:${record.id}`,
      kind: "CHARACTER",
      label: record.nameOverride ?? record.name,
      href: `/characters/${record.id}`,
      action: archiveAction(record.createdAt, record.updatedAt),
      occurredAt: record.updatedAt.toISOString(),
      platform: record.sources[0]?.platform ?? null,
    })),
    ...recentLorebooks.map((record): FreshActivityItem => ({
      key: `lorebook:${record.id}`,
      kind: "LOREBOOK",
      label: record.title,
      href: `/lorebooks/${record.id}`,
      action: archiveAction(record.createdAt, record.updatedAt),
      occurredAt: record.updatedAt.toISOString(),
      platform: record.sourcePlatform,
    })),
  ].sort(compareActivity).slice(0, FRESH_ACTIVITY_LIMIT);

  return {
    items: characters.map((record) => ({
      id: record.id,
      name: record.nameOverride ?? record.name,
      description: normalizeSourceProse(record.descriptionOverride ?? record.description),
      avatarUrl: resolveCharacterArtworkUrl(record),
      status: record.status as FreshCharacterItem["status"],
      publishedAt: record.publishedAt!.toISOString(),
      uploaderName: record.firstAddedBy.displayName ?? record.firstAddedBy.username,
      sources: record.sources,
      tags: record.tags.map(({ tag }) => tag),
      tagCount: record._count.tags,
    })),
    activity,
    generatedAt: now.toISOString(),
    window: input.window,
    sort: input.sort,
  };
}

function startForWindow(window: FreshWindow, now: Date): Date {
  const duration = window === "week" ? 7 * 24 * 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  return new Date(now.getTime() - duration);
}

function archiveAction(createdAt: Date, updatedAt: Date): FreshActivityItem["action"] {
  return updatedAt.getTime() - createdAt.getTime() > 1_000 ? "Updated in archive" : "Added to archive";
}

function compareActivity(left: FreshActivityItem, right: FreshActivityItem): number {
  const timeDifference = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  return timeDifference || left.key.localeCompare(right.key);
}
