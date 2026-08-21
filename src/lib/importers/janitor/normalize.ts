import type {
  NormalizedCharacter,
  NormalizedGreeting,
  NormalizedLorebookReference,
  NormalizedTag,
} from "../types";
import { parseJanitorCharacterUrl } from "./parse-url";
import type {
  JanitorCharacterResponse,
  JanitorGreetingValue,
  JanitorScript,
  JanitorTag,
} from "./types";
import { normalizeJanitorSourceText } from "./normalize-source-text";

export type JanitorNormalizationErrorCode = "MISSING_NAME" | "SOURCE_ID_MISMATCH";

export class JanitorNormalizationError extends Error {
  readonly code: JanitorNormalizationErrorCode;

  constructor(code: JanitorNormalizationErrorCode, message: string) {
    super(message);
    this.name = "JanitorNormalizationError";
    this.code = code;
  }
}

const JANITOR_AVATAR_ASSET_BASE_URL = "https://ella.janitorai.com/bot-avatars/";

export function normalizeJanitorCharacter(
  source: JanitorCharacterResponse,
  sourceUrl: string,
): NormalizedCharacter {
  const externalId = parseJanitorCharacterUrl(sourceUrl);
  const sourceExternalId = cleanString(source.id);
  const name = cleanString(source.name);

  if (sourceExternalId && sourceExternalId.toLowerCase() !== externalId) {
    throw new JanitorNormalizationError(
      "SOURCE_ID_MISMATCH",
      `Janitor AI source ID "${sourceExternalId}" does not match URL ID "${externalId}".`,
    );
  }

  if (!name) {
    throw new JanitorNormalizationError(
      "MISSING_NAME",
      "Janitor AI character data must contain a non-empty name.",
    );
  }

  return {
    externalId,
    platform: "JANITOR_AI",
    sourceUrl,
    name,
    description: normalizeJanitorSourceText(source.description),
    personality: normalizeJanitorSourceText(source.personality),
    scenario: normalizeJanitorSourceText(source.scenario),
    exampleDialogs: normalizeJanitorSourceText(source.example_dialogs),
    avatarUrl: normalizeAvatarUrl(source.avatar),
    creator: {
      externalId: cleanString(source.creator_id),
      name: cleanString(source.creator_name),
    },
    greetings: normalizeGreetings(source),
    tags: normalizeTags(source.tags),
    lorebookReferences: normalizeLorebookReferences(source.scripts),
    sourceCreatedAt: parseDateOrNull(source.created_at),
    sourceUpdatedAt: parseDateOrNull(source.updated_at),
    rawData: source,
  };
}

function normalizeGreetings(source: JanitorCharacterResponse): NormalizedGreeting[] {
  const preferredGreetings = source.first_messages ?? [];
  const preferredContents = preferredGreetings
    .map(getGreetingContent)
    .filter((content): content is string => content !== null);

  const contents =
    preferredContents.length > 0
      ? preferredContents
      : [getGreetingContent(source.first_message)].filter(
          (content): content is string => content !== null,
        );

  const uniqueContents = [...new Set(contents)];

  return uniqueContents.map((content, position) => ({ content, position }));
}

function getGreetingContent(value: JanitorGreetingValue | null | undefined): string | null {
  if (typeof value === "string") {
    return normalizeJanitorSourceText(value);
  }

  if (!value) {
    return null;
  }

  return normalizeJanitorSourceText(value.content)
    ?? normalizeJanitorSourceText(value.message)
    ?? normalizeJanitorSourceText(value.text);
}

function normalizeTags(tags: Array<JanitorTag | null> | null | undefined): NormalizedTag[] {
  const normalizedTags = (tags ?? []).flatMap((tag) => {
    if (!tag) return [];

    const providedName = cleanString(tag.name);
    const providedSlug = cleanString(tag.slug);
    const name = providedName ?? providedSlug;

    if (!name) return [];

    const slug = slugify(providedSlug ?? name);
    if (!slug) return [];

    const externalId = cleanIdentifier(tag.id);
    return [{ ...(externalId ? { externalId } : {}), name, slug }];
  });

  return uniqueBy(normalizedTags, (tag) => tag.slug);
}

function normalizeLorebookReferences(
  scripts: Array<JanitorScript | null> | null | undefined,
): NormalizedLorebookReference[] {
  const references = (scripts ?? []).flatMap((script) => {
    if (!script || script.type !== "lorebook") return [];

    const externalId = cleanString(script.id);
    if (!externalId) return [];

    return [
      {
        externalId,
        title: cleanString(script.title) ?? "Untitled lorebook",
      },
    ];
  });

  return uniqueBy(references, (reference) => reference.externalId);
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seenKeys = new Set<string>();

  return items.filter((item) => {
    const key = getKey(item);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
}

function cleanString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : null;
}

function cleanIdentifier(value: string | number | null | undefined): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  return cleanString(value);
}

function normalizeAvatarUrl(value: string | null | undefined): string | null {
  const avatar = cleanString(value);
  if (!avatar) return null;

  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(avatar)) {
    return `${JANITOR_AVATAR_ASSET_BASE_URL}${encodeURIComponent(avatar)}`;
  }

  return avatar;
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseDateOrNull(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}
