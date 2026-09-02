import { TAG_SEARCH_QUERY_MAX_LENGTH } from "../tags/normalization";

export const AUTHOR_TAG_DEFAULT_LIMIT = 30;
export const AUTHOR_TAG_MAX_LIMIT = 50;
export const AUTHOR_TAG_MAX_PAGE = 10_000;

export interface AuthorTagSearchInput {
  query: string;
  page: number;
  limit: number;
}

export interface AuthorTagSearchItem {
  tagId: string;
  slug: string;
  canonicalName: string;
  displayLabel: string;
  count: number;
  group: string;
}

export interface AuthorTagSearchResult {
  items: AuthorTagSearchItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export class AuthorTagSearchInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorTagSearchInputError";
  }
}

export function parseAuthorTagSearchParams(params: URLSearchParams): AuthorTagSearchInput {
  const allowed = new Set(["q", "page", "limit"]);
  for (const key of params.keys()) {
    if (!allowed.has(key)) throw new AuthorTagSearchInputError(`Unknown author tag parameter: ${key}.`);
  }
  const query = params.get("q")?.trim() ?? "";
  if (query.length > TAG_SEARCH_QUERY_MAX_LENGTH) {
    throw new AuthorTagSearchInputError(`Tag search must be ${TAG_SEARCH_QUERY_MAX_LENGTH} characters or fewer.`);
  }
  return {
    query,
    page: boundedInteger(params.get("page"), 1, AUTHOR_TAG_MAX_PAGE, "page"),
    limit: boundedInteger(params.get("limit"), AUTHOR_TAG_DEFAULT_LIMIT, AUTHOR_TAG_MAX_LIMIT, "limit"),
  };
}

function boundedInteger(value: string | null, fallback: number, maximum: number, field: string): number {
  if (value === null) return fallback;
  if (!/^\d+$/u.test(value)) throw new AuthorTagSearchInputError(`${field} must be a positive integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new AuthorTagSearchInputError(`${field} must be between 1 and ${maximum}.`);
  }
  return parsed;
}
