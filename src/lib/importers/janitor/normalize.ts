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

export type JanitorNormalizationErrorCode = "MISSING_NAME" | "SOURCE_ID_MISMATCH";

export class JanitorNormalizationError extends Error {
  readonly code: JanitorNormalizationErrorCode;

  constructor(code: JanitorNormalizationErrorCode, message: string) {
    super(message);
    this.name = "JanitorNormalizationError";
    this.code = code;
  }
}

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
    description: cleanString(source.description),
    personality: cleanString(source.personality),
    scenario: cleanString(source.scenario),
    exampleDialogs: cleanString(source.example_dialogs),
    avatarUrl: cleanString(source.avatar),
    creator: {
      externalId: cleanString(source.creator_id),
      name: cleanString(source.creator_name),
    },
    greetings: normalizeGreetings(source),
    tags: normalizeTags(source.tags),
    lorebookReferences: normalizeLorebookReferences(source.scripts),
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
    return cleanString(value);
  }

  if (!value) {
    return null;
  }

  return cleanString(value.content) ?? cleanString(value.message) ?? cleanString(value.text);
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

    const externalId = cleanString(tag.id);
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

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
