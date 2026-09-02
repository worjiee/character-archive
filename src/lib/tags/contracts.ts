import type { PersistedSourcePlatform } from "../sources/presentation";
import { TAG_SEARCH_QUERY_MAX_LENGTH } from "./normalization";

export const TAG_SEARCH_DEFAULT_LIMIT = 50;
export const TAG_SEARCH_MAX_LIMIT = 100;
export const TAG_SEARCH_MAX_PAGE = 10_000;
export const TAG_VOCABULARY_SOURCES = [
  "ALL",
  "JANITOR_AI",
  "SAUCEPAN",
  "DATACAT",
  "OTHER",
] as const;

export type TagVocabularySource = "ALL" | PersistedSourcePlatform;

export interface TagSearchInput {
  query: string;
  source: TagVocabularySource;
  page: number;
  limit: number;
}

export interface TagSearchItem {
  tagId: string;
  slug: string;
  canonicalName: string;
  displayLabel: string;
  source: TagVocabularySource;
  count: number;
  group: string;
}

export interface TagSearchResult {
  items: TagSearchItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface SelectedTagOption {
  slug: string;
  label: string;
}

export class TagSearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagSearchInputError";
  }
}

export function parseTagSearchParams(params: URLSearchParams): TagSearchInput {
  const allowed = new Set(["q", "source", "page", "limit"]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new TagSearchInputError(`Unknown tag search parameter: ${key}.`);
  }

  const query = params.get("q")?.trim() ?? "";
  if (query.length > TAG_SEARCH_QUERY_MAX_LENGTH) {
    throw new TagSearchInputError(`Tag search must be ${TAG_SEARCH_QUERY_MAX_LENGTH} characters or fewer.`);
  }

  const sourceValue = params.get("source") ?? "ALL";
  if (!(TAG_VOCABULARY_SOURCES as readonly string[]).includes(sourceValue)) {
    throw new TagSearchInputError("Unknown tag vocabulary source.");
  }

  return {
    query,
    source: sourceValue as TagVocabularySource,
    page: parseBoundedInteger(params.get("page"), 1, TAG_SEARCH_MAX_PAGE, "page"),
    limit: parseBoundedInteger(params.get("limit"), TAG_SEARCH_DEFAULT_LIMIT, TAG_SEARCH_MAX_LIMIT, "limit"),
  };
}

function parseBoundedInteger(
  value: string | null,
  fallback: number,
  maximum: number,
  field: string,
): number {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) throw new TagSearchInputError(`Tag search ${field} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TagSearchInputError(`Tag search ${field} must be between 1 and ${maximum}.`);
  }
  return parsed;
}
