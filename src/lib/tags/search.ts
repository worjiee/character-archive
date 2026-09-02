import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type {
  TagSearchInput,
  TagSearchItem,
  TagSearchResult,
  SelectedTagOption,
} from "./contracts";
import { alphabeticalTagGroup, normalizeTagLabel } from "./normalization";

type RawTagSearchRow = {
  tagId: string | null;
  slug: string | null;
  canonicalName: string | null;
  displayLabel: string | null;
  normalizedLabel: string | null;
  platform: TagSearchInput["source"] | null;
  characterCount: number | bigint | null;
  totalCount: number | bigint;
};

/**
 * Searches the ordinary published catalog vocabulary for every authenticated
 * role. Admin moderation visibility is intentionally not inferred here.
 */
export async function searchCatalogTags(
  input: TagSearchInput,
  client?: PrismaClient,
): Promise<TagSearchResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const normalizedQuery = normalizeTagLabel(input.query);
  const offset = (input.page - 1) * input.limit;
  const allowContains = normalizedQuery.length >= 2;
  const rows = input.source === "ALL"
    ? await database.$queryRaw<RawTagSearchRow[]>(canonicalVocabularyQuery({
        normalizedQuery,
        allowContains,
        limit: input.limit,
        offset,
      }))
    : await database.$queryRaw<RawTagSearchRow[]>(sourceVocabularyQuery({
        source: input.source,
        normalizedQuery,
        allowContains,
        limit: input.limit,
        offset,
      }));

  const total = Number(rows[0]?.totalCount ?? 0);
  const items = rows.flatMap((row): TagSearchItem[] => {
    if (
      !row.tagId
      || !row.slug
      || !row.canonicalName
      || !row.displayLabel
      || row.normalizedLabel === null
      || row.characterCount === null
    ) return [];
    return [{
      tagId: row.tagId,
      slug: row.slug,
      canonicalName: row.canonicalName,
      displayLabel: row.displayLabel,
      source: input.source,
      count: Number(row.characterCount),
      group: alphabeticalTagGroup(row.normalizedLabel),
    }];
  });

  return {
    items,
    page: input.page,
    limit: input.limit,
    total,
    hasMore: offset + items.length < total,
  };
}

export async function getSelectedCatalogTags(
  slugs: readonly string[],
  client?: PrismaClient,
): Promise<SelectedTagOption[]> {
  if (slugs.length === 0) return [];
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const records = await database.tag.findMany({
    where: {
      slug: { in: [...slugs] },
      characters: {
        some: {
          character: { status: "ACTIVE", publishedAt: { not: null } },
        },
      },
    },
    select: { slug: true, name: true },
  });
  const labels = new Map(records.map((record) => [record.slug, record.name]));
  return slugs.flatMap((slug) => {
    const label = labels.get(slug);
    return label ? [{ slug, label }] : [];
  });
}

function canonicalVocabularyQuery(input: {
  normalizedQuery: string;
  allowContains: boolean;
  limit: number;
  offset: number;
}): Prisma.Sql {
  const match = tagMatchSql(input.normalizedQuery, input.allowContains, Prisma.sql`t."normalizedLabel"`);
  const rank = tagRankSql(input.normalizedQuery, Prisma.sql`t."normalizedLabel"`);
  return Prisma.sql`
    WITH vocabulary AS (
      SELECT
        t."id" AS "tagId",
        t."slug",
        t."name" AS "canonicalName",
        t."name" AS "displayLabel",
        t."normalizedLabel",
        CAST(NULL AS TEXT) AS "platform",
        COUNT(DISTINCT ct."characterId")::int AS "characterCount",
        ${rank} AS "matchRank"
      FROM "Tag" AS t
      JOIN "CharacterTag" AS ct ON ct."tagId" = t."id"
      JOIN "Character" AS c ON c."id" = ct."characterId"
      WHERE c."status" = 'ACTIVE'::"CharacterStatus"
        AND c."publishedAt" IS NOT NULL
        ${match}
      GROUP BY t."id", t."slug", t."name", t."normalizedLabel"
    ), page_rows AS (
      SELECT *
      FROM vocabulary
      ORDER BY "matchRank", "normalizedLabel", "displayLabel", "tagId"
      LIMIT ${input.limit} OFFSET ${input.offset}
    ), summary AS (
      SELECT COUNT(*)::int AS "totalCount" FROM vocabulary
    )
    SELECT page_rows.*, summary."totalCount"
    FROM summary
    LEFT JOIN page_rows ON TRUE
    ORDER BY page_rows."matchRank" NULLS LAST,
      page_rows."normalizedLabel" NULLS LAST,
      page_rows."displayLabel" NULLS LAST,
      page_rows."tagId" NULLS LAST
  `;
}

function sourceVocabularyQuery(input: {
  source: Exclude<TagSearchInput["source"], "ALL">;
  normalizedQuery: string;
  allowContains: boolean;
  limit: number;
  offset: number;
}): Prisma.Sql {
  const match = tagMatchSql(input.normalizedQuery, input.allowContains, Prisma.sql`st."normalizedLabel"`);
  const rank = tagRankSql(input.normalizedQuery, Prisma.sql`st."normalizedLabel"`);
  return Prisma.sql`
    WITH vocabulary AS (
      SELECT
        t."id" AS "tagId",
        t."slug",
        t."name" AS "canonicalName",
        MIN(st."rawLabel" COLLATE "C") AS "displayLabel",
        st."normalizedLabel",
        cs."platform"::text AS "platform",
        COUNT(DISTINCT c."id")::int AS "characterCount",
        ${rank} AS "matchRank"
      FROM "SourceTag" AS st
      JOIN "Tag" AS t ON t."id" = st."tagId"
      JOIN "CharacterSource" AS cs ON cs."id" = st."characterSourceId"
      JOIN "Character" AS c ON c."id" = cs."characterId"
      WHERE cs."platform" = ${input.source}::"SourcePlatform"
        AND c."status" = 'ACTIVE'::"CharacterStatus"
        AND c."publishedAt" IS NOT NULL
        ${match}
      GROUP BY t."id", t."slug", t."name", st."normalizedLabel", cs."platform"
    ), page_rows AS (
      SELECT *
      FROM vocabulary
      ORDER BY "matchRank", "normalizedLabel", "displayLabel", "tagId"
      LIMIT ${input.limit} OFFSET ${input.offset}
    ), summary AS (
      SELECT COUNT(*)::int AS "totalCount" FROM vocabulary
    )
    SELECT page_rows.*, summary."totalCount"
    FROM summary
    LEFT JOIN page_rows ON TRUE
    ORDER BY page_rows."matchRank" NULLS LAST,
      page_rows."normalizedLabel" NULLS LAST,
      page_rows."displayLabel" NULLS LAST,
      page_rows."tagId" NULLS LAST
  `;
}

function tagMatchSql(query: string, allowContains: boolean, column: Prisma.Sql): Prisma.Sql {
  if (!query) return Prisma.empty;
  const prefix = `${query}%`;
  if (!allowContains) return Prisma.sql`AND ${column} LIKE ${prefix}`;
  return Prisma.sql`AND (${column} LIKE ${prefix} OR ${column} LIKE ${`%${query}%`})`;
}

function tagRankSql(query: string, column: Prisma.Sql): Prisma.Sql {
  if (!query) return Prisma.sql`0`;
  return Prisma.sql`CASE
    WHEN ${column} = ${query} THEN 0
    WHEN ${column} LIKE ${`${query}%`} THEN 1
    ELSE 2
  END`;
}
