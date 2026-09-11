import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type { AuthenticatedPrincipal } from "../auth";
import type { CharacterBrowseResult, CharacterCardItem, PageMetadata } from "../characters/browse";
import type { PersistedSourcePlatform } from "../sources/presentation";
import { alphabeticalTagGroup, normalizeTagLabel } from "../tags/normalization";
import type { AuthorTagSearchInput, AuthorTagSearchResult } from "./contracts";
import { AUTHOR_DEFAULT_PAGE_SIZE, AUTHOR_MAX_PAGE_SIZE } from "./constants";
import type { AuthorIdentity } from "./identity";
import { normalizeCreatorName } from "./identity";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export { AUTHOR_DEFAULT_PAGE_SIZE, AUTHOR_MAX_PAGE_SIZE } from "./constants";

export type AuthorBrowseSort = "name-asc" | "name-desc" | "characters-desc" | "recent";
export type AuthorBrowseSource = "ALL" | PersistedSourcePlatform;
export type AuthorCharacterSort = "published-newest" | "published-oldest" | "name-asc" | "name-desc";

export interface AuthorBrowseInput {
  query: string;
  source: AuthorBrowseSource;
  sort: AuthorBrowseSort;
  favoriteOnly: boolean;
  page: number;
  pageSize: number;
}

export interface AuthorCharacterBrowseInput {
  query: string;
  tags: string[];
  sort: AuthorCharacterSort;
  page: number;
  pageSize: number;
}

export interface AuthorListItem {
  identity: AuthorIdentity;
  creatorName: string;
  characterCount: number;
  latestPublishedAt: Date;
  tagPreview: Array<{ label: string; slug: string; count: number }>;
  isFavorited: boolean;
  favoriteProvenance: Array<"MANUAL" | "DATACAT">;
}

export interface AuthorBrowseResult {
  items: AuthorListItem[];
  pagination: { page: number; pageSize: number; hasPrevious: boolean; hasNext: boolean };
}

export interface AuthorProfile {
  identity: AuthorIdentity;
  creatorName: string;
  characterCount: number;
  latestPublishedAt: Date;
  sourceProfileUrl: null;
  isFavorited: boolean;
  favoriteProvenance: Array<"MANUAL" | "DATACAT">;
}

type AuthorRow = {
  platform: string;
  identityKind: "EXTERNAL_ID" | "CREATOR_NAME";
  identityValue: string;
  creatorName: string;
  characterCount: bigint | number;
  latestPublishedAt: Date;
  isFavorited: boolean;
  favoriteProvenance: Array<"MANUAL" | "DATACAT">;
};

type AuthorTagPreviewRow = {
  platform: string;
  identityKind: "EXTERNAL_ID" | "CREATOR_NAME";
  identityValue: string;
  displayLabel: string;
  slug: string;
  characterCount: bigint | number;
};

const CREATOR_NAME_SQL = Prisma.sql`lower(regexp_replace(normalize(BTRIM(cs."creatorName"), NFKC), '\\s+', ' ', 'g'))`;
const CATALOG_VISIBILITY_SQL = Prisma.sql`c.status = 'ACTIVE'::"CharacterStatus" AND c."publishedAt" IS NOT NULL`;

export async function browseAuthors(
  input: AuthorBrowseInput,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<AuthorBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const sourceFilter = input.source === "ALL" ? Prisma.empty : Prisma.sql`AND cs.platform = ${input.source}::"SourcePlatform"`;
  const normalizedQuery = normalizeCreatorName(input.query);
  const queryFilter = normalizedQuery
    ? Prisma.sql`AND (
        POSITION(${normalizedQuery} IN COALESCE(${CREATOR_NAME_SQL}, '')) > 0
        OR POSITION(${normalizedQuery} IN lower(COALESCE(NULLIF(BTRIM(cs."externalCreatorId"), ''), ''))) > 0
      )`
    : Prisma.empty;
  const order = authorOrderSql(input.sort);
  const favoriteFilter = input.favoriteOnly
    ? Prisma.sql`WHERE EXISTS (
        SELECT 1 FROM "UserFavoriteCreator" ufc
        WHERE ufc."userId" = ${principal.userId}
          AND ufc.platform::text = a.platform
          AND ufc."identityKind"::text = a."identityKind"
          AND ufc."identityValue" = a."identityValue"
      )`
    : Prisma.empty;
  const rows = await database.$queryRaw<AuthorRow[]>(Prisma.sql`
    WITH eligible AS (
      SELECT
        cs.platform::text AS platform,
        CASE WHEN NULLIF(BTRIM(cs."externalCreatorId"), '') IS NOT NULL THEN 'EXTERNAL_ID' ELSE 'CREATOR_NAME' END AS "identityKind",
        COALESCE(NULLIF(BTRIM(cs."externalCreatorId"), ''), ${CREATOR_NAME_SQL}) AS "identityValue",
        COALESCE(NULLIF(BTRIM(cs."creatorName"), ''), 'Unknown creator') AS "creatorName",
        cs.id AS "sourceId",
        COALESCE(cs."lastSuccessfulSyncAt", cs."lastSyncedAt", cs."firstSeenAt") AS "evidenceAt",
        c.id AS "characterId",
        c."publishedAt"
      FROM "CharacterSource" cs
      JOIN "Character" c ON c.id = cs."characterId"
      WHERE ${CATALOG_VISIBILITY_SQL}
        AND (NULLIF(BTRIM(cs."externalCreatorId"), '') IS NOT NULL OR NULLIF(${CREATOR_NAME_SQL}, '') IS NOT NULL)
        ${sourceFilter}
        ${queryFilter}
    ), aggregated AS (
      SELECT platform, "identityKind", "identityValue",
        (ARRAY_AGG("creatorName" ORDER BY "evidenceAt" DESC, "sourceId" DESC))[1] AS "creatorName",
        COUNT(DISTINCT "characterId") AS "characterCount", MAX("publishedAt") AS "latestPublishedAt"
      FROM eligible GROUP BY platform, "identityKind", "identityValue"
    )
    SELECT a.*,
      EXISTS (
        SELECT 1 FROM "UserFavoriteCreator" ufc
        WHERE ufc."userId" = ${principal.userId} AND ufc.platform::text = a.platform
          AND ufc."identityKind"::text = a."identityKind" AND ufc."identityValue" = a."identityValue"
      ) AS "isFavorited",
      COALESCE(ARRAY(
        SELECT claim.provenance::text FROM "UserFavoriteCreator" ufc
        JOIN "UserFavoriteCreatorClaim" claim ON claim."favoriteCreatorId" = ufc.id
        WHERE ufc."userId" = ${principal.userId} AND ufc.platform::text = a.platform
          AND ufc."identityKind"::text = a."identityKind" AND ufc."identityValue" = a."identityValue"
        ORDER BY claim.provenance::text
      ), ARRAY[]::text[]) AS "favoriteProvenance"
    FROM aggregated a
    ${favoriteFilter}
    ORDER BY ${order}
    OFFSET ${(page - 1) * pageSize}
    LIMIT ${pageSize + 1}
  `);
  const visibleRows = rows.slice(0, pageSize);
  const previews = await getAuthorTagPreviews(visibleRows, database);

  return {
    items: visibleRows.map((row) => ({
      identity: rowIdentity(row),
      creatorName: row.creatorName,
      characterCount: Number(row.characterCount),
      latestPublishedAt: row.latestPublishedAt,
      tagPreview: previews.get(rowKey(row)) ?? [],
      isFavorited: row.isFavorited,
      favoriteProvenance: row.favoriteProvenance,
    })),
    pagination: { page, pageSize, hasPrevious: page > 1, hasNext: rows.length > pageSize },
  };
}

export async function getAuthorProfile(
  identity: AuthorIdentity,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<AuthorProfile | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const rows = await database.$queryRaw<AuthorRow[]>(Prisma.sql`
    WITH matching AS (
      SELECT cs.platform::text AS platform,
        COALESCE(NULLIF(BTRIM(cs."creatorName"), ''), 'Unknown creator') AS "creatorName",
        COALESCE(cs."lastSuccessfulSyncAt", cs."lastSyncedAt", cs."firstSeenAt") AS "evidenceAt",
        cs.id AS "sourceId", c.id AS "characterId", c."publishedAt"
      FROM "CharacterSource" cs JOIN "Character" c ON c.id = cs."characterId"
      WHERE ${CATALOG_VISIBILITY_SQL} AND ${authorIdentitySql(identity)}
    )
    SELECT ${identity.platform} AS platform, ${identity.kind} AS "identityKind", ${identity.value} AS "identityValue",
      (ARRAY_AGG("creatorName" ORDER BY "evidenceAt" DESC, "sourceId" DESC))[1] AS "creatorName",
      COUNT(DISTINCT "characterId") AS "characterCount", MAX("publishedAt") AS "latestPublishedAt",
      EXISTS (SELECT 1 FROM "UserFavoriteCreator" ufc WHERE ufc."userId" = ${principal.userId}
        AND ufc.platform = ${identity.platform}::"SourcePlatform"
        AND ufc."identityKind" = ${identity.kind}::"CreatorIdentityKind" AND ufc."identityValue" = ${identity.value}) AS "isFavorited",
      COALESCE(ARRAY(SELECT claim.provenance::text FROM "UserFavoriteCreator" ufc
        JOIN "UserFavoriteCreatorClaim" claim ON claim."favoriteCreatorId" = ufc.id
        WHERE ufc."userId" = ${principal.userId} AND ufc.platform = ${identity.platform}::"SourcePlatform"
          AND ufc."identityKind" = ${identity.kind}::"CreatorIdentityKind" AND ufc."identityValue" = ${identity.value}
        ORDER BY claim.provenance::text), ARRAY[]::text[]) AS "favoriteProvenance"
    FROM matching
    HAVING COUNT(*) > 0
    LIMIT 1
  `);
  const row = rows[0];
  return row ? {
    identity,
    creatorName: row.creatorName,
    characterCount: Number(row.characterCount),
    latestPublishedAt: row.latestPublishedAt,
    sourceProfileUrl: null,
    isFavorited: row.isFavorited,
    favoriteProvenance: row.favoriteProvenance,
  } : null;
}

export async function browseAuthorCharacters(
  identity: AuthorIdentity,
  input: AuthorCharacterBrowseInput,
  _principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterBrowseResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const queryFilter = input.query.trim()
    ? Prisma.sql`AND POSITION(lower(${input.query.trim()}) IN lower(COALESCE(NULLIF(c."nameOverride", ''), c.name))) > 0`
    : Prisma.empty;
  const tagFilter = input.tags.length > 0
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "CharacterTag" ct JOIN "Tag" t ON t.id = ct."tagId"
        WHERE ct."characterId" = c.id AND t.slug IN (${Prisma.join(input.tags)})
      )`
    : Prisma.empty;
  const order = characterOrderSql(input.sort);
  const [rows, countRows] = await Promise.all([
    database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT DISTINCT c.id, COALESCE(NULLIF(c."nameOverride", ''), c.name) AS "displayName", c."publishedAt"
      FROM "Character" c
      WHERE ${CATALOG_VISIBILITY_SQL}
        AND EXISTS (SELECT 1 FROM "CharacterSource" cs WHERE cs."characterId" = c.id AND ${authorIdentitySql(identity)})
        ${queryFilter} ${tagFilter}
      ORDER BY ${order}
      OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
    `),
    database.$queryRaw<Array<{ count: bigint | number }>>(Prisma.sql`
      SELECT COUNT(DISTINCT c.id) AS count
      FROM "Character" c
      WHERE ${CATALOG_VISIBILITY_SQL}
        AND EXISTS (SELECT 1 FROM "CharacterSource" cs WHERE cs."characterId" = c.id AND ${authorIdentitySql(identity)})
        ${queryFilter} ${tagFilter}
    `),
  ]);
  const ids = rows.map(({ id }) => id);
  const records = ids.length > 0 ? await database.character.findMany({
    where: { id: { in: ids } },
    select: characterCardSelect,
  }) : [];
  const byId = new Map(records.map((record) => [record.id, toCharacterCard(record)]));
  const totalItems = Number(countRows[0]?.count ?? 0);
  return { items: ids.flatMap((id) => byId.get(id) ?? []), pagination: pageMetadata(page, pageSize, totalItems) };
}

export async function getAuthorRecentCharacters(
  identity: AuthorIdentity,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterCardItem[]> {
  return (await browseAuthorCharacters(identity, {
    query: "", tags: [], sort: "published-newest", page: 1, pageSize: 4,
  }, principal, client)).items;
}

export async function searchAuthorTags(
  identity: AuthorIdentity,
  input: AuthorTagSearchInput,
  _principal?: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<AuthorTagSearchResult> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const normalizedQuery = normalizeTagLabel(input.query);
  const queryFilter = normalizedQuery
    ? Prisma.sql`AND POSITION(${normalizedQuery} IN st."normalizedLabel") > 0`
    : Prisma.empty;
  const offset = (input.page - 1) * input.limit;
  const rows = await database.$queryRaw<Array<{
    tagId: string; slug: string; canonicalName: string; displayLabel: string;
    normalizedLabel: string; characterCount: bigint | number; totalRows: bigint | number;
  }>>(Prisma.sql`
    WITH tags AS (
      SELECT st."tagId", t.slug, t.name AS "canonicalName", MIN(st."rawLabel") AS "displayLabel",
        MIN(st."normalizedLabel") AS "normalizedLabel", COUNT(DISTINCT c.id) AS "characterCount"
      FROM "SourceTag" st
      JOIN "CharacterSource" cs ON cs.id = st."characterSourceId"
      JOIN "Character" c ON c.id = cs."characterId"
      JOIN "Tag" t ON t.id = st."tagId"
      WHERE ${CATALOG_VISIBILITY_SQL} AND ${authorIdentitySql(identity)} ${queryFilter}
      GROUP BY st."tagId", t.slug, t.name
    )
    SELECT *, COUNT(*) OVER() AS "totalRows" FROM tags
    ORDER BY
      ${normalizedQuery ? Prisma.sql`CASE WHEN "normalizedLabel" = ${normalizedQuery} THEN 0 WHEN "normalizedLabel" LIKE ${`${normalizedQuery}%`} THEN 1 ELSE 2 END,` : Prisma.empty}
      "normalizedLabel" ASC, "displayLabel" ASC, "tagId" ASC
    OFFSET ${offset} LIMIT ${input.limit}
  `);
  const total = Number(rows[0]?.totalRows ?? 0);
  return {
    items: rows.map((row) => ({
      tagId: row.tagId,
      slug: row.slug,
      canonicalName: row.canonicalName,
      displayLabel: row.displayLabel,
      count: Number(row.characterCount),
      group: alphabeticalTagGroup(row.normalizedLabel),
    })),
    page: input.page,
    limit: input.limit,
    total,
    hasMore: offset + rows.length < total,
  };
}

export async function getSelectedAuthorTags(
  identity: AuthorIdentity,
  slugs: string[],
  _principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<Array<{ slug: string; label: string }>> {
  if (slugs.length === 0) return [];
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$queryRaw<Array<{ slug: string; label: string }>>(Prisma.sql`
    SELECT t.slug, MIN(st."rawLabel") AS label
    FROM "SourceTag" st
    JOIN "CharacterSource" cs ON cs.id = st."characterSourceId"
    JOIN "Character" c ON c.id = cs."characterId"
    JOIN "Tag" t ON t.id = st."tagId"
    WHERE ${CATALOG_VISIBILITY_SQL} AND ${authorIdentitySql(identity)} AND t.slug IN (${Prisma.join(slugs.slice(0, 50))})
    GROUP BY t.slug ORDER BY MIN(st."normalizedLabel") ASC, t.slug ASC
  `);
}

async function getAuthorTagPreviews(rows: AuthorRow[], database: PrismaClient): Promise<Map<string, AuthorListItem["tagPreview"]>> {
  if (rows.length === 0) return new Map();
  const identities = rows.map((row) => Prisma.sql`(${row.platform}, ${row.identityKind}, ${row.identityValue})`);
  const previews = await database.$queryRaw<AuthorTagPreviewRow[]>(Prisma.sql`
    WITH requested(platform, "identityKind", "identityValue") AS (VALUES ${Prisma.join(identities)}),
    source_rows AS (
      SELECT cs.platform::text AS platform,
        CASE WHEN NULLIF(BTRIM(cs."externalCreatorId"), '') IS NOT NULL THEN 'EXTERNAL_ID' ELSE 'CREATOR_NAME' END AS "identityKind",
        COALESCE(NULLIF(BTRIM(cs."externalCreatorId"), ''), ${CREATOR_NAME_SQL}) AS "identityValue",
        st."rawLabel", st."normalizedLabel", t.slug, c.id AS "characterId"
      FROM "SourceTag" st
      JOIN "CharacterSource" cs ON cs.id = st."characterSourceId"
      JOIN "Character" c ON c.id = cs."characterId"
      JOIN "Tag" t ON t.id = st."tagId"
      WHERE ${CATALOG_VISIBILITY_SQL}
    ),
    aggregated AS (
      SELECT s.platform, s."identityKind", s."identityValue", MIN(s."rawLabel") AS "displayLabel",
        s.slug, COUNT(DISTINCT s."characterId") AS "characterCount", MIN(s."normalizedLabel") AS "normalizedLabel"
      FROM source_rows s
      JOIN requested r ON r.platform = s.platform AND r."identityKind" = s."identityKind" AND r."identityValue" = s."identityValue"
      GROUP BY s.platform, s."identityKind", s."identityValue", s.slug
    ),
    ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY platform, "identityKind", "identityValue"
        ORDER BY "characterCount" DESC, "normalizedLabel" ASC, slug ASC) AS rank
      FROM aggregated
    )
    SELECT platform, "identityKind", "identityValue", "displayLabel", slug, "characterCount"
    FROM ranked WHERE rank <= 4 ORDER BY platform, "identityValue", rank
  `);
  const result = new Map<string, AuthorListItem["tagPreview"]>();
  for (const row of previews) {
    const key = rowKey(row);
    const tags = result.get(key) ?? [];
    tags.push({ label: row.displayLabel, slug: row.slug, count: Number(row.characterCount) });
    result.set(key, tags);
  }
  return result;
}

function authorIdentitySql(identity: AuthorIdentity): Prisma.Sql {
  if (identity.kind === "EXTERNAL_ID") {
    return Prisma.sql`cs.platform = ${identity.platform}::"SourcePlatform" AND NULLIF(BTRIM(cs."externalCreatorId"), '') = ${identity.value}`;
  }
  return Prisma.sql`cs.platform = ${identity.platform}::"SourcePlatform" AND NULLIF(BTRIM(cs."externalCreatorId"), '') IS NULL AND ${CREATOR_NAME_SQL} = ${identity.value}`;
}

function authorOrderSql(sort: AuthorBrowseSort): Prisma.Sql {
  switch (sort) {
    case "name-desc": return Prisma.sql`lower("creatorName") DESC, platform ASC, "identityKind" ASC, "identityValue" ASC`;
    case "characters-desc": return Prisma.sql`"characterCount" DESC, lower("creatorName") ASC, platform ASC, "identityValue" ASC`;
    case "recent": return Prisma.sql`"latestPublishedAt" DESC, lower("creatorName") ASC, platform ASC, "identityValue" ASC`;
    default: return Prisma.sql`lower("creatorName") ASC, platform ASC, "identityKind" ASC, "identityValue" ASC`;
  }
}

function characterOrderSql(sort: AuthorCharacterSort): Prisma.Sql {
  switch (sort) {
    case "published-oldest": return Prisma.sql`c."publishedAt" ASC, c.id ASC`;
    case "name-asc": return Prisma.sql`"displayName" ASC, c.id ASC`;
    case "name-desc": return Prisma.sql`"displayName" DESC, c.id DESC`;
    default: return Prisma.sql`c."publishedAt" DESC, c.id DESC`;
  }
}

const characterCardSelect = {
  id: true, name: true, nameOverride: true, avatarUrl: true, avatarUrlOverride: true, artworkSha256: true, status: true, tokenCount: true, permanentTokenCount: true,
  sources: { orderBy: { firstSeenAt: "asc" as const }, select: { platform: true, creatorName: true } },
  tags: { orderBy: { tag: { name: "asc" as const } }, select: { tag: { select: { name: true, slug: true } } } },
} satisfies Prisma.CharacterSelect;

type CharacterCardRecord = Prisma.CharacterGetPayload<{ select: typeof characterCardSelect }>;

function toCharacterCard(record: CharacterCardRecord): CharacterCardItem {
  return {
    id: record.id,
    name: record.nameOverride ?? record.name,
    avatarUrl: resolveCharacterArtworkUrl(record),
    status: record.status as CharacterCardItem["status"],
    tokenCount: record.tokenCount,
    permanentTokenCount: record.permanentTokenCount,
    sources: record.sources,
    tags: record.tags.map(({ tag }) => tag),
  };
}

function rowIdentity(row: Pick<AuthorRow, "platform" | "identityKind" | "identityValue">): AuthorIdentity {
  return { platform: row.platform as PersistedSourcePlatform, kind: row.identityKind, value: row.identityValue } as AuthorIdentity;
}

function rowKey(row: { platform: string; identityKind: string; identityValue: string }): string {
  return `${row.platform}:${row.identityKind}:${row.identityValue}`;
}

function normalizePage(value: number): number {
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

function normalizePageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return AUTHOR_DEFAULT_PAGE_SIZE;
  return Math.min(value, AUTHOR_MAX_PAGE_SIZE);
}

function pageMetadata(page: number, pageSize: number, totalItems: number): PageMetadata {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return { page, pageSize, totalItems, totalPages, hasPrevious: page > 1, hasNext: page < totalPages };
}
