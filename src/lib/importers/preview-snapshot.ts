import type { NormalizedCharacter } from "./types";
import { ARTWORK_SHA256_PATTERN, type PendingArtworkBinding } from "../artwork/types";

export const IMPORT_PREVIEW_SNAPSHOT_VERSION = 2;

export interface ImportPreviewSnapshotV1 {
  schema: "import-preview-character";
  version: 1;
  character: Omit<NormalizedCharacter, "sourceCreatedAt" | "sourceUpdatedAt" | "rawData"> & {
    sourceCreatedAt: string | null;
    sourceUpdatedAt: string | null;
  };
}

export interface ImportPreviewSnapshotV2 {
  schema: "import-preview-character";
  version: 2;
  character: ImportPreviewSnapshotV1["character"];
  artwork: PendingArtworkBinding | null;
}

export interface RestoredImportPreviewSnapshot {
  character: NormalizedCharacter;
  artwork: PendingArtworkBinding | null;
}

export function createImportPreviewSnapshot(
  character: NormalizedCharacter,
  artwork: PendingArtworkBinding | null = null,
): ImportPreviewSnapshotV2 {
  const { rawData: _discardedUpstreamData, sourceCreatedAt, sourceUpdatedAt, ...safeCharacter } = character;
  void _discardedUpstreamData;
  return cloneJson({
    schema: "import-preview-character",
    version: IMPORT_PREVIEW_SNAPSHOT_VERSION,
    character: {
      ...safeCharacter,
      sourceCreatedAt: sourceCreatedAt?.toISOString() ?? null,
      sourceUpdatedAt: sourceUpdatedAt?.toISOString() ?? null,
    },
    artwork,
  });
}

export function restoreImportPreviewSnapshot(value: unknown): RestoredImportPreviewSnapshot {
  if (!isRecord(value) || value.schema !== "import-preview-character" || (value.version !== 1 && value.version !== 2)) {
    throw new ImportPreviewSnapshotError("Unknown or invalid import preview snapshot version.");
  }
  const character = value.character;
  if (!isRecord(character) || !isSnapshotCharacter(character)) {
    throw new ImportPreviewSnapshotError("The stored import preview snapshot is invalid.");
  }

  const restoredCharacter: NormalizedCharacter = {
    externalId: character.externalId as string,
    platform: character.platform as NormalizedCharacter["platform"],
    sourceUrl: character.sourceUrl as string,
    name: character.name as string,
    description: nullableString(character.description),
    personality: nullableString(character.personality),
    scenario: nullableString(character.scenario),
    exampleDialogs: nullableString(character.exampleDialogs),
    avatarUrl: nullableString(character.avatarUrl),
    creator: character.creator as NormalizedCharacter["creator"],
    greetings: character.greetings as NormalizedCharacter["greetings"],
    tags: character.tags as NormalizedCharacter["tags"],
    lorebookReferences: character.lorebookReferences as NormalizedCharacter["lorebookReferences"],
    ...(character.embeddedLorebooks === undefined
      ? {}
      : { embeddedLorebooks: character.embeddedLorebooks as NormalizedCharacter["embeddedLorebooks"] }),
    sourceCreatedAt: parseSnapshotDate(character.sourceCreatedAt),
    sourceUpdatedAt: parseSnapshotDate(character.sourceUpdatedAt),
    rawData: {
      schema: "archive-normalized-character",
      version: 1,
      character,
    },
  };
  const artwork = value.version === 2 ? value.artwork : null;
  if (artwork !== null && !isPendingArtworkBinding(artwork)) {
    throw new ImportPreviewSnapshotError("The stored preview artwork binding is invalid.");
  }
  return { character: restoredCharacter, artwork };
}

export class ImportPreviewSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportPreviewSnapshotError";
  }
}

function isSnapshotCharacter(value: Record<string, unknown>): boolean {
  return typeof value.externalId === "string"
    && ["JANITOR_AI", "SAUCEPAN", "DATACAT", "OTHER"].includes(String(value.platform))
    && typeof value.sourceUrl === "string"
    && typeof value.name === "string"
    && isNullableString(value.description)
    && isNullableString(value.personality)
    && isNullableString(value.scenario)
    && isNullableString(value.exampleDialogs)
    && isNullableString(value.avatarUrl)
    && isCreator(value.creator)
    && isGreetings(value.greetings)
    && isTags(value.tags)
    && isLorebookReferences(value.lorebookReferences)
    && (value.embeddedLorebooks === undefined || isEmbeddedLorebooks(value.embeddedLorebooks))
    && isNullableDateString(value.sourceCreatedAt)
    && isNullableDateString(value.sourceUpdatedAt);
}

function isEmbeddedLorebooks(value: unknown): boolean {
  return Array.isArray(value) && value.every((book) => isRecord(book)
    && typeof book.externalId === "string"
    && ["JANITOR_AI", "SAUCEPAN", "DATACAT", "OTHER"].includes(String(book.platform))
    && typeof book.title === "string"
    && isNullableString(book.description)
    && typeof book.sourceUrl === "string"
    && Array.isArray(book.entries)
    && book.entries.every((entry) => isRecord(entry)
      && typeof entry.externalEntryId === "string"
      && typeof entry.content === "string"
      && Array.isArray(entry.keys) && entry.keys.every((key) => typeof key === "string")
      && isNullableString(entry.category)
      && typeof entry.enabled === "boolean"
      && typeof entry.constant === "boolean"
      && Number.isSafeInteger(entry.insertionOrder)
      && isNullableString(entry.comment)
      && (entry.caseSensitive === null || typeof entry.caseSensitive === "boolean")
      && isNullableString(entry.activationMode)
      && isNullableString(entry.activationScript)
      && (entry.groupWeight === null || Number.isSafeInteger(entry.groupWeight))));
}

function isCreator(value: unknown): boolean {
  return isRecord(value) && isNullableString(value.externalId) && isNullableString(value.name);
}

function isGreetings(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && typeof item.content === "string" && Number.isSafeInteger(item.position));
}

function isTags(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && typeof item.name === "string" && typeof item.slug === "string"
    && (item.externalId === undefined || typeof item.externalId === "string"));
}

function isLorebookReferences(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => isRecord(item)
    && typeof item.externalId === "string" && typeof item.title === "string");
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isNullableDateString(value: unknown): boolean {
  return value === null || (typeof value === "string" && Number.isFinite(new Date(value).getTime()));
}

function isPendingArtworkBinding(value: unknown): value is PendingArtworkBinding {
  return isRecord(value)
    && typeof value.sha256 === "string" && ARTWORK_SHA256_PATTERN.test(value.sha256)
    && value.mediaType === "image/png"
    && Number.isSafeInteger(value.byteLength) && Number(value.byteLength) > 0
    && Number.isSafeInteger(value.width) && Number(value.width) > 0
    && Number.isSafeInteger(value.height) && Number(value.height) > 0
    && typeof value.pendingKey === "string" && value.pendingKey.length <= 300
    && typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt));
}

function parseSnapshotDate(value: unknown): Date | null {
  if (value === null) return null;
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw new ImportPreviewSnapshotError("The stored snapshot contains an invalid date.");
  return date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
