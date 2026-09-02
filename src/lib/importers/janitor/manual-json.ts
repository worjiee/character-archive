import type { NormalizedCharacter } from "../types";
import { normalizeJanitorCharacter } from "./normalize";
import { canonicalJanitorCharacterUrl, isValidJanitorCharacterId, parseJanitorCharacterUrl } from "./parse-url";
import type {
  JanitorCharacterResponse,
  JanitorGreetingValue,
  JanitorScript,
  JanitorTag,
} from "./types";

export const MAX_MANUAL_CHARACTER_JSON_BYTES = 1024 * 1024;
export const MAX_JANITOR_CUSTOM_TAGS = 200;
export const MAX_JANITOR_CUSTOM_TAG_BYTES = 128;

export type ManualJanitorImportErrorCode =
  | "EMPTY_CHARACTER_JSON"
  | "INVALID_CHARACTER_JSON"
  | "INVALID_CHARACTER_RESPONSE"
  | "INVALID_CHARACTER_ID"
  | "MISSING_CHARACTER_NAME"
  | "CHARACTER_JSON_TOO_LARGE"
  | "CREDENTIAL_DATA_REJECTED";

export class ManualJanitorImportError extends Error {
  readonly code: ManualJanitorImportErrorCode;

  constructor(code: ManualJanitorImportErrorCode, message: string) {
    super(message);
    this.name = "ManualJanitorImportError";
    this.code = code;
  }
}

export function normalizeManualJanitorCharacter(
  sourceUrl: string,
  sourceJson: string,
): NormalizedCharacter {
  const externalId = parseJanitorCharacterUrl(sourceUrl);
  return normalizeJanitorCharacter(
    parseManualJanitorCharacterJson(sourceJson),
    canonicalJanitorCharacterUrl(externalId),
  );
}

export function parseManualJanitorCharacterJson(sourceJson: string): JanitorCharacterResponse {
  if (typeof sourceJson !== "string" || sourceJson.trim().length === 0) {
    throw new ManualJanitorImportError(
      "EMPTY_CHARACTER_JSON",
      "Janitor character JSON is required.",
    );
  }

  if (new TextEncoder().encode(sourceJson).byteLength > MAX_MANUAL_CHARACTER_JSON_BYTES) {
    throw new ManualJanitorImportError(
      "CHARACTER_JSON_TOO_LARGE",
      "Janitor character JSON must be 1 MB or smaller.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(sourceJson);
  } catch {
    throw new ManualJanitorImportError(
      "INVALID_CHARACTER_JSON",
      "Janitor character data must be valid JSON.",
    );
  }

  return validateJanitorCharacterSource(parsed);
}

export function validateJanitorCharacterSource(value: unknown): JanitorCharacterResponse {
  if (!isRecord(value)) {
    throw new ManualJanitorImportError(
      "INVALID_CHARACTER_RESPONSE",
      "Janitor character JSON must contain one character object.",
    );
  }

  rejectCredentialShapedData(value);
  validateCharacterShape(value);
  return value as JanitorCharacterResponse;
}

function validateCharacterShape(source: Record<string, unknown>): void {
  if (typeof source.id !== "string" || !isValidJanitorCharacterId(source.id)) {
    throw new ManualJanitorImportError(
      "INVALID_CHARACTER_ID",
      "Janitor character JSON must contain a valid character UUID.",
    );
  }

  if (typeof source.name !== "string" || source.name.trim().length === 0) {
    throw new ManualJanitorImportError(
      "MISSING_CHARACTER_NAME",
      "Janitor character JSON must contain a non-empty name.",
    );
  }

  for (const field of [
    "description",
    "personality",
    "scenario",
    "example_dialogs",
    "avatar",
    "creator_id",
    "creator_name",
    "created_at",
    "updated_at",
  ]) {
    validateNullableString(source[field], field);
  }

  for (const field of ["is_public", "is_deleted"]) {
    const value = source[field];
    if (value !== undefined && value !== null && typeof value !== "boolean") {
      invalidField(field);
    }
  }

  validateGreeting(source.first_message, "first_message");
  validateOptionalArray(source.first_messages, "first_messages", (value, index) =>
    validateGreeting(value, `first_messages[${index}]`));
  validateOptionalArray(source.tags, "tags", validateTag);
  validateCustomTags(source.custom_tags);
  validateOptionalArray(source.scripts, "scripts", validateScript);
}

function validateCustomTags(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.length > MAX_JANITOR_CUSTOM_TAGS) invalidField("custom_tags");
  value.forEach((tag, index) => {
    if (tag === null) return;
    if (typeof tag !== "string" || tag.trim().length === 0 || new TextEncoder().encode(tag).byteLength > MAX_JANITOR_CUSTOM_TAG_BYTES) {
      invalidField(`custom_tags[${index}]`);
    }
  });
}

function validateGreeting(value: unknown, field: string): asserts value is JanitorGreetingValue | null | undefined {
  if (value === undefined || value === null || typeof value === "string") return;
  if (!isRecord(value)) invalidField(field);
  for (const child of ["content", "message", "text"]) {
    validateNullableString(value[child], `${field}.${child}`);
  }
}

function validateTag(value: unknown, index: number): asserts value is JanitorTag | null {
  if (value === null) return;
  if (!isRecord(value)) invalidField(`tags[${index}]`);
  validateNullableTagId(value.id, `tags[${index}].id`);
  for (const child of ["name", "slug", "description"]) {
    validateNullableString(value[child], `tags[${index}].${child}`);
  }
}

function validateScript(value: unknown, index: number): asserts value is JanitorScript | null {
  if (value === null) return;
  if (!isRecord(value)) invalidField(`scripts[${index}]`);
  for (const child of ["id", "type", "title"]) {
    validateNullableString(value[child], `scripts[${index}].${child}`);
  }
}

function validateOptionalArray(
  value: unknown,
  field: string,
  validateItem: (item: unknown, index: number) => void,
): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) invalidField(field);
  value.forEach(validateItem);
}

function validateNullableString(value: unknown, field: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") invalidField(field);
}

function validateNullableTagId(value: unknown, field: string): void {
  if (value === undefined || value === null || typeof value === "string") return;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return;
  invalidField(field);
}

function invalidField(field: string): never {
  throw new ManualJanitorImportError(
    "INVALID_CHARACTER_RESPONSE",
    `Janitor character JSON contains an invalid ${field} field.`,
  );
}

const REJECTED_KEYS = new Set([
  "authorization",
  "bearer",
  "bearertoken",
  "headers",
  "cookie",
  "cookies",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "session",
  "sessionid",
  "sessiontoken",
  "token",
  "password",
  "apikey",
  "clientsecret",
  "secretkey",
  "localstorage",
  "sessionstorage",
  "indexeddb",
  "cloudflare",
  "cloudflarestate",
  "cfclearance",
]);

function rejectCredentialShapedData(root: Record<string, unknown>): void {
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!isRecord(current)) continue;

    for (const [key, value] of Object.entries(current)) {
      const normalizedKey = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (REJECTED_KEYS.has(normalizedKey)) {
        throw new ManualJanitorImportError(
          "CREDENTIAL_DATA_REJECTED",
          "Credential, session, cookie, or browser-storage data is not accepted. Paste only the character response JSON.",
        );
      }
      if (typeof value === "object" && value !== null) pending.push(value);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
