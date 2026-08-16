import type { NormalizedLorebook, NormalizedLorebookEntry } from "../types";
import type {
  JanitorLorebookSourceEntry,
  NormalizeJanitorLorebookMetadata,
} from "./lorebook-types";

export type JanitorLorebookNormalizationErrorCode =
  | "INVALID_SOURCE"
  | "INVALID_METADATA"
  | "INVALID_ENTRY"
  | "DUPLICATE_ENTRY_ID";

export class JanitorLorebookNormalizationError extends Error {
  readonly code: JanitorLorebookNormalizationErrorCode;
  readonly entryIndex?: number;

  constructor(
    code: JanitorLorebookNormalizationErrorCode,
    message: string,
    entryIndex?: number,
  ) {
    super(message);
    this.name = "JanitorLorebookNormalizationError";
    this.code = code;
    this.entryIndex = entryIndex;
  }
}

export function normalizeJanitorLorebook(
  source: unknown,
  metadata: NormalizeJanitorLorebookMetadata,
): NormalizedLorebook {
  if (!Array.isArray(source)) {
    throw new JanitorLorebookNormalizationError(
      "INVALID_SOURCE",
      "Janitor lorebook source must be an array.",
    );
  }

  const externalId = requiredMetadata(metadata.externalId, "externalId");
  const title = requiredMetadata(metadata.title, "title");
  const sourceUrl = requiredMetadata(metadata.sourceUrl, "sourceUrl");
  const entries = source.map((entry, index) => normalizeEntry(entry, index));
  const seenEntryIds = new Set<string>();

  for (const entry of entries) {
    if (seenEntryIds.has(entry.externalEntryId)) {
      throw new JanitorLorebookNormalizationError(
        "DUPLICATE_ENTRY_ID",
        `Janitor lorebook contains duplicate entry ID "${entry.externalEntryId}".`,
      );
    }
    seenEntryIds.add(entry.externalEntryId);
  }

  return {
    externalId,
    platform: "JANITOR_AI",
    title,
    description: optionalMetadata(metadata.description, "description"),
    sourceUrl,
    entries,
    rawData: source,
  };
}

function normalizeEntry(value: unknown, index: number): NormalizedLorebookEntry {
  if (!isRecord(value)) entryError(index, "must be an object");
  const entry = value as JanitorLorebookSourceEntry;
  const externalEntryId = normalizeEntryId(entry.id, index);
  const content = requiredEntryString(entry.content, "content", index, false);

  return {
    externalEntryId,
    content,
    keys: normalizeKeys(entry.key, index),
    category: optionalEntryString(entry.category, "category", index),
    enabled: optionalBoolean(entry.enabled, "enabled", index) ?? true,
    constant: optionalBoolean(entry.constant, "constant", index) ?? false,
    insertionOrder: optionalInteger(entry.insertion_order, "insertion_order", index) ?? index,
    comment: optionalEntryString(entry.comment, "comment", index),
    caseSensitive: optionalBoolean(entry.case_sensitive, "case_sensitive", index),
    activationMode: optionalEntryString(entry.activationMode, "activationMode", index),
    activationScript: optionalEntryString(entry.activationScript, "activationScript", index),
    groupWeight: optionalInteger(entry.groupWeight, "groupWeight", index),
    rawData: entry,
  };
}

function normalizeEntryId(value: unknown, index: number): string {
  if (typeof value === "string") {
    const id = value.trim();
    if (id) return id;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return entryError(index, "must contain a non-empty string or safe integer id");
}

function normalizeKeys(value: unknown, index: number): string[] {
  if (value === undefined || value === null) return [];
  const values = typeof value === "string" ? [value] : value;
  if (!Array.isArray(values) || values.some((key) => typeof key !== "string")) {
    return entryError(index, "key must be a string or an array of strings");
  }
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function requiredEntryString(
  value: unknown,
  field: string,
  index: number,
  trim = true,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return entryError(index, `${field} must be a non-empty string`);
  }
  return trim ? value.trim() : value;
}

function optionalEntryString(value: unknown, field: string, index: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return entryError(index, `${field} must be a string when present`);
  const normalized = value.trim();
  return normalized || null;
}

function optionalBoolean(value: unknown, field: string, index: number): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") return entryError(index, `${field} must be a boolean when present`);
  return value;
}

function optionalInteger(value: unknown, field: string, index: number): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) return entryError(index, `${field} must be a safe integer when present`);
  return value as number;
}

function requiredMetadata(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JanitorLorebookNormalizationError(
      "INVALID_METADATA",
      `Janitor lorebook ${field} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function optionalMetadata(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new JanitorLorebookNormalizationError(
      "INVALID_METADATA",
      `Janitor lorebook ${field} must be a string when present.`,
    );
  }
  return value.trim() || null;
}

function entryError(index: number, message: string): never {
  throw new JanitorLorebookNormalizationError(
    "INVALID_ENTRY",
    `Janitor lorebook entry at index ${index} ${message}.`,
    index,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
