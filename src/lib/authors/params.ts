import type { BrowseSearchParams } from "../archive/browse-params";
import {
  PERSISTED_SOURCE_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../sources/presentation";
import type { AuthorBrowseInput, AuthorBrowseSort, AuthorCharacterBrowseInput, AuthorCharacterSort } from "./browse";
import { AUTHOR_DEFAULT_PAGE_SIZE } from "./constants";
import type { AuthorIdentity } from "./identity";
import { normalizeCreatorName } from "./identity";

const AUTHOR_SORTS = new Set<AuthorBrowseSort>(["name-asc", "name-desc", "characters-desc", "recent"]);
const CHARACTER_SORTS = new Set<AuthorCharacterSort>(["published-newest", "published-oldest", "name-asc", "name-desc"]);
const PERSISTED_PLATFORMS = new Set<string>(PERSISTED_SOURCE_PLATFORM_KEYS);
const MAX_QUERY_LENGTH = 160;
const MAX_IDENTITY_LENGTH = 200;

export function parseAuthorBrowseParams(params: BrowseSearchParams): AuthorBrowseInput {
  const sortValue = first(params.sort);
  const sourceValue = first(params.source)?.trim().toUpperCase();
  return {
    query: first(params.q)?.trim().slice(0, MAX_QUERY_LENGTH) ?? "",
    source: sourceValue && PERSISTED_PLATFORMS.has(sourceValue)
      ? sourceValue as PersistedSourcePlatform
      : "ALL",
    sort: sortValue && AUTHOR_SORTS.has(sortValue as AuthorBrowseSort)
      ? sortValue as AuthorBrowseSort
      : "name-asc",
    favoriteOnly: first(params.favorite) === "true",
    page: validPage(first(params.page)),
    pageSize: AUTHOR_DEFAULT_PAGE_SIZE,
  };
}

export function parseAuthorCharacterBrowseParams(params: BrowseSearchParams): AuthorCharacterBrowseInput {
  const sortValue = first(params.sort);
  return {
    query: first(params.q)?.trim().slice(0, MAX_QUERY_LENGTH) ?? "",
    tags: unique(params.tag)
      .filter((value) => value.length <= 100 && /^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(value))
      .slice(0, 20),
    sort: sortValue && CHARACTER_SORTS.has(sortValue as AuthorCharacterSort)
      ? sortValue as AuthorCharacterSort
      : "published-newest",
    page: validPage(first(params.page)),
    pageSize: AUTHOR_DEFAULT_PAGE_SIZE,
  };
}

export function parseAuthorIdentity(platformValue: string, routeValue: string): AuthorIdentity | null {
  const platform = platformValue.trim().toUpperCase();
  if (!PERSISTED_PLATFORMS.has(platform)) return null;
  const decoded = safeDecode(routeValue).trim();
  if (!decoded || decoded.length > MAX_IDENTITY_LENGTH || /\p{Cc}/u.test(decoded)) return null;

  if (decoded.startsWith("name~")) {
    const value = normalizeCreatorName(decoded.slice(5));
    return value ? { platform: platform as PersistedSourcePlatform, kind: "CREATOR_NAME", value } : null;
  }
  const value = decoded.startsWith("id~") ? decoded.slice(3).trim() : decoded;
  return value ? { platform: platform as PersistedSourcePlatform, kind: "EXTERNAL_ID", value } : null;
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
  if (next.source !== "ALL") params.set("source", next.source);
  if (next.sort !== "name-asc") params.set("sort", next.sort);
  if (next.favoriteOnly) params.set("favorite", "true");
  if (next.page > 1) params.set("page", String(next.page));
  return withQuery("/authors", params);
}

export function authorDetailHref(author: AuthorIdentity): string {
  const value = `${author.kind === "EXTERNAL_ID" ? "id" : "name"}~${author.value}`;
  return `/authors/${encodeURIComponent(author.platform)}/${encodeURIComponent(value)}`;
}

export function authorCharacterBrowseHref(
  author: AuthorIdentity,
  current: AuthorCharacterBrowseInput,
  patch: Partial<AuthorCharacterBrowseInput>,
  options: { preservePage?: boolean } = {},
): string {
  const next = { ...current, ...patch };
  if (!options.preservePage) next.page = 1;
  const params = new URLSearchParams();
  if (next.query) params.set("q", next.query);
  if (next.sort !== "published-newest") params.set("sort", next.sort);
  if (next.page > 1) params.set("page", String(next.page));
  for (const tag of next.tags) params.append("tag", tag);
  return withQuery(authorDetailHref(author), params);
}

export function authorTagApiHref(author: AuthorIdentity, input: { query: string; page: number; limit: number }): string {
  const params = new URLSearchParams();
  if (input.query) params.set("q", input.query);
  if (input.page > 1) params.set("page", String(input.page));
  params.set("limit", String(input.limit));
  return withQuery(`/api${authorDetailHref(author)}/tags`, params);
}

function validPage(value: string | undefined): number {
  if (!value || !/^\d+$/u.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function unique(value: string | string[] | undefined): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value); } catch { return ""; }
}

function withQuery(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
