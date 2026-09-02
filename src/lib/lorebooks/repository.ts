import type { PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../auth";
import type { PersistedSourcePlatform } from "../sources/presentation";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export interface LorebookListItem {
  id: string;
  externalId: string;
  title: string;
  description: string | null;
  sourcePlatform: PersistedSourcePlatform;
  sourceUrl: string;
  createdAt: Date;
  updatedAt: Date;
  lastSyncedAt: Date | null;
  entryCount: number;
  characterCount: number;
}

export interface LorebookDetail extends LorebookListItem {
  entries: Array<{
    id: string;
    externalEntryId: string;
    content: string;
    keys: string[];
    category: string | null;
    comment: string | null;
    caseSensitive: boolean | null;
    activationMode: string | null;
    groupWeight: number | null;
    enabled: boolean;
    constant: boolean;
    insertionOrder: number;
  }>;
  characters: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    status: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
    sources: Array<{
      platform: PersistedSourcePlatform;
      creatorName: string | null;
      sourceUrl: string;
    }>;
  }>;
}

export async function getLorebookById(
  id: string,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<LorebookDetail | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const record = await database.lorebook.findFirst({
    where: {
      id,
      ...(principal.role === "MEMBER"
        ? { characters: { some: { character: visibleCharacterWhere(principal) } } }
        : {}),
    },
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
      entries: {
        orderBy: [{ insertionOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          externalEntryId: true,
          content: true,
          keys: true,
          category: true,
          comment: true,
          caseSensitive: true,
          activationMode: true,
          groupWeight: true,
          enabled: true,
          constant: true,
          insertionOrder: true,
        },
      },
      characters: {
        where: principal.role === "MEMBER"
          ? { character: visibleCharacterWhere(principal) }
          : undefined,
        select: {
          character: {
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
                select: { platform: true, creatorName: true, sourceUrl: true },
              },
            },
          },
        },
      },
    },
  });

  if (!record) return null;

  const { _count, characters, entries, ...lorebook } = record;
  return {
    ...lorebook,
    entryCount: _count.entries,
    characterCount: _count.characters,
    entries: [...entries].sort((left, right) =>
      left.insertionOrder - right.insertionOrder || left.id.localeCompare(right.id)),
    characters: characters
      .map(({ character }) => ({
        id: character.id,
        name: character.nameOverride ?? character.name,
        avatarUrl: resolveCharacterArtworkUrl(character),
        status: character.status,
        sources: character.sources,
      }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
  };
}
