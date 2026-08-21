import type { BrowseSearchParams } from "../archive/browse-params";
import { characterBrowseHref } from "../archive/browse-params";
import type {
  CharacterBrowseAuthorScope,
  CharacterBrowseInput,
} from "../characters/browse";
import {
  PERSISTED_SOURCE_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../sources/presentation";
import {
  type AuthorBrowseInput,
  type AuthorBrowseSort,
} from "./browse";
import { AUTHOR_DEFAULT_PAGE_SIZE } from "./constants";

const AUTHOR_SORTS = new Set<AuthorBrowseSort>(["name-asc", "name-desc", "characters-desc", "recent"]);
const PERSISTED_PLATFORMS = new Set<string>(PERSISTED_SOURCE_PLATFORM_KEYS);
const MAX_QUERY_LENGTH = 160;
const MAX_EXTERNAL_CREATOR_ID_LENGTH = 200;

export function parseAuthorBrowseParams(params: BrowseSearchParams): AuthorBrowseInput {
  const sortValue = first(params.sort);
  return {
    query: first(params.q)?.trim().slice(0, MAX_QUERY_LENGTH) ?? "",
    sort: sortValue && AUTHOR_SORTS.has(sortValue as AuthorBrowseSort)
      ? sortValue as AuthorBrowseSort
      : "name-asc",
    page: validPage(first(params.page)),
    pageSize: AUTHOR_DEFAULT_PAGE_SIZE,
  };
}

export function parseAuthorIdentity(
  platformValue: string,
  externalCreatorIdValue: string,
): CharacterBrowseAuthorScope | null {
  const platform = platformValue.trim().toUpperCase();
  const externalCreatorId = externalCreatorIdValue.trim();
  if (!PERSISTED_PLATFORMS.has(platform)) return null;
  if (!externalCreatorId || externalCreatorId.length > MAX_EXTERNAL_CREATOR_ID_LENGTH) return null;
  if (/\p{Cc}/u.test(externalCreatorId)) return null;
  return {
    platform: platform as PersistedSourcePlatform,
    externalCreatorId,
  };
}

export function authorsBrowseHref(
  current: AuthorBrowseInput,
  patch: Partial<AuthorBrowseInput>,
  options: { preservePage?: boolean } = {},
): string {
  const next = { ...current, ...patch };
  if (!options.preservePage) next.page = 1;
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.sort !== "name-asc") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  return withQuery("/authors", params);
}

export function authorDetailHref(author: CharacterBrowseAuthorScope): string {
  return `/authors/${encodeURIComponent(author.platform)}/${encodeURIComponent(author.externalCreatorId)}`;
}

export function authorCharacterBrowseHref(
  author: CharacterBrowseAuthorScope,
  current: CharacterBrowseInput,
  patch: Partial<CharacterBrowseInput>,
  options: { preservePage?: boolean } = {},
): string {
  const query = characterBrowseHref(
    { ...current, sources: [], author },
    { ...patch, sources: [], author },
    options,
  ).slice("/characters".length);
  return `${authorDetailHref(author)}${query}`;
}

function validPage(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function withQuery(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
