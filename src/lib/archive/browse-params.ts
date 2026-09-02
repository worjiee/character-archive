import {
  type CharacterBrowseInput,
  type CharacterBrowseSort,
} from "../characters/browse";
import {
  type LorebookBrowseInput,
  type LorebookBrowseSort,
} from "../lorebooks/browse";
import {
  PERSISTED_SOURCE_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../sources/presentation";
import {
  TAG_VOCABULARY_SOURCES,
  type TagVocabularySource,
} from "../tags/contracts";

export type BrowseSearchParams = Record<string, string | string[] | undefined>;

const CHARACTER_SORTS = new Set<CharacterBrowseSort>([
  "updated",
  "updated-oldest",
  "newest",
  "oldest",
  "name-asc",
  "name-desc",
  "archive_updated_newest",
  "archive_added_newest",
  "archive_added_oldest",
  "name_asc",
  "name_desc",
]);
const LOREBOOK_SORTS = new Set<LorebookBrowseSort>(["updated", "newest", "oldest", "title-asc", "title-desc"]);
const SOURCE_PLATFORMS = new Set<string>(PERSISTED_SOURCE_PLATFORM_KEYS);
const TAG_SOURCES = new Set<string>(TAG_VOCABULARY_SOURCES);
const CHARACTER_STATUSES = new Set<string>(["ACTIVE", "QUARANTINED", "BLOCKED"]);
const MAX_FILTER_VALUES = 20;
const MAX_QUERY_LENGTH = 160;
const MAX_FILTER_VALUE_LENGTH = 100;

export function parseCharacterBrowseParams(params: BrowseSearchParams): CharacterBrowseInput {
  return {
    query: first(params.q)?.trim().slice(0, MAX_QUERY_LENGTH) ?? "",
    sources: validSources(many(params.source)),
    tags: uniqueSafeValues(many(params.tag)).filter(isCanonicalTagSlug),
    tagSource: validTagSource(first(params.tagSource)),
    statuses: uniqueSafeValues(many(params.status))
      .filter((value): value is CharacterBrowseInput["statuses"][number] => CHARACTER_STATUSES.has(value)),
    sort: validSort(first(params.sort), CHARACTER_SORTS, "updated"),
    page: validPage(first(params.page)),
    pageSize: 30,
  };
}

export function parseLorebookBrowseParams(params: BrowseSearchParams): LorebookBrowseInput {
  return {
    query: first(params.q)?.trim().slice(0, MAX_QUERY_LENGTH) ?? "",
    sources: validSources(many(params.source)),
    sort: validSort(first(params.sort), LOREBOOK_SORTS, "updated"),
    page: validPage(first(params.page)),
    pageSize: 30,
  };
}

export function characterBrowseHref(
  current: CharacterBrowseInput,
  patch: Partial<CharacterBrowseInput>,
  options: { preservePage?: boolean } = {},
): string {
  const next = { ...current, ...patch };
  if (!options.preservePage) next.page = 1;
  const params = new URLSearchParams();
  appendCommon(params, next.query, next.sources, next.sort, "updated", next.page);
  for (const tag of next.tags) params.append("tag", tag);
  if (next.tagSource !== "ALL") params.set("tagSource", next.tagSource);
  for (const status of next.statuses) params.append("status", status);
  return withQuery("/characters", params);
}

export function lorebookBrowseHref(
  current: LorebookBrowseInput,
  patch: Partial<LorebookBrowseInput>,
  options: { preservePage?: boolean } = {},
): string {
  const next = { ...current, ...patch };
  if (!options.preservePage) next.page = 1;
  const params = new URLSearchParams();
  appendCommon(params, next.query, next.sources, next.sort, "updated", next.page);
  return withQuery("/lorebooks", params);
}

function appendCommon(
  params: URLSearchParams,
  query: string,
  sources: readonly PersistedSourcePlatform[],
  sort: string,
  defaultSort: string,
  page: number,
) {
  if (query) params.set("q", query);
  for (const source of sources) params.append("source", source);
  if (sort !== defaultSort) params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
}

function validSources(values: string[]): PersistedSourcePlatform[] {
  return uniqueSafeValues(values)
    .filter((value): value is PersistedSourcePlatform => SOURCE_PLATFORMS.has(value));
}

function validTagSource(value: string | undefined): TagVocabularySource {
  return value && TAG_SOURCES.has(value) ? value as TagVocabularySource : "ALL";
}

function uniqueSafeValues(values: string[]): string[] {
  return [...new Set(values
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= MAX_FILTER_VALUE_LENGTH))]
    .slice(0, MAX_FILTER_VALUES);
}

function isCanonicalTagSlug(value: string): boolean {
  return /^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(value);
}

function validSort<T extends string>(value: string | undefined, supported: Set<T>, fallback: T): T {
  return value && supported.has(value as T) ? value as T : fallback;
}

function validPage(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function withQuery(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
