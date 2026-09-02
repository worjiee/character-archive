import {
  MAX_MANUAL_CHARACTER_JSON_BYTES,
  ManualJanitorImportError,
  validateJanitorCharacterSource,
} from "../importers/janitor";
import { canonicalJanitorCharacterUrl, parseJanitorCharacterUrl } from "../importers/janitor/parse-url";
import type { JanitorCharacterResponse } from "../importers/janitor/types";
import { BridgeError } from "./errors";
import { sameBridgeTarget, type BridgeTarget } from "./target";

const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
const ENVELOPE_KEYS = new Set([
  "bridgeVersion",
  "observerContractVersion",
  "messageId",
  "platform",
  "type",
  "capturedAt",
  "source",
  "payload",
]);
const CANONICAL_PAYLOAD_KEYS = new Set([
  "externalId",
  "sourceUrl",
  "rawData",
  "greetings",
  "lorebookReferences",
  "exampleDialogs",
  "avatarUrl",
]);

export interface JanitorCharacterBridgeEnvelope {
  bridgeVersion: 1;
  observerContractVersion: 1;
  messageId: string;
  platform: "JANITOR_AI";
  type: "CHARACTER";
  capturedAt: Date;
  sourceUrl: string;
  payload: JanitorCharacterResponse;
}

export function validateJanitorCharacterBridgeEnvelope(
  value: unknown,
  expectedTarget: BridgeTarget,
): JanitorCharacterBridgeEnvelope {
  if (!isRecord(value)) invalid("INVALID_BRIDGE_ENVELOPE", "The bridge envelope must be an object.");
  for (const key of Object.keys(value)) {
    if (!ENVELOPE_KEYS.has(key)) invalid("UNKNOWN_BRIDGE_FIELD", `Unknown bridge envelope field: ${key}.`);
  }
  if (value.bridgeVersion !== 1) invalid("WRONG_BRIDGE_VERSION", "Only bridge version 1 is supported.");
  if (value.observerContractVersion !== 1) {
    invalid("SOURCE_CONTRACT_CHANGED", "The Janitor observer contract is not supported.", 422);
  }
  if (value.platform !== "JANITOR_AI") invalid("WRONG_BRIDGE_PLATFORM", "The bridge platform must be JANITOR_AI.");
  if (value.type !== "CHARACTER") invalid("WRONG_BRIDGE_TYPE", "The bridge payload type must be CHARACTER.");
  if (typeof value.messageId !== "string" || !MESSAGE_ID.test(value.messageId)) {
    invalid("INVALID_MESSAGE_ID", "The bridge messageId must be a UUID v4.");
  }
  if (typeof value.capturedAt !== "string" || !ISO_TIMESTAMP.test(value.capturedAt)) {
    invalid("INVALID_CAPTURED_AT", "capturedAt must be an ISO timestamp.");
  }
  const capturedAt = new Date(value.capturedAt);
  if (!Number.isFinite(capturedAt.getTime())) invalid("INVALID_CAPTURED_AT", "capturedAt must be an ISO timestamp.");
  if (!isRecord(value.source) || Object.keys(value.source).length !== 1 || typeof value.source.url !== "string") {
    invalid("INVALID_SOURCE_URL", "The bridge source must contain only a Janitor character URL.");
  }

  let externalId: string;
  try {
    externalId = parseJanitorCharacterUrl(value.source.url);
    const parsedSourceUrl = new URL(value.source.url);
    if (
      parsedSourceUrl.username ||
      parsedSourceUrl.password ||
      parsedSourceUrl.search ||
      parsedSourceUrl.hash
    ) {
      invalid(
        "INVALID_SOURCE_URL",
        "The bridge source URL must not contain credentials, query parameters, or a fragment.",
      );
    }
  } catch {
    invalid("INVALID_SOURCE_URL", "The bridge source URL must be a valid Janitor character URL.");
  }
  const canonicalTarget: BridgeTarget = {
    targetKind: "CHARACTER",
    platform: "JANITOR_AI",
    externalId,
    canonicalSourceUrl: canonicalJanitorCharacterUrl(externalId),
  };
  if (value.source.url !== canonicalTarget.canonicalSourceUrl || !sameBridgeTarget(canonicalTarget, expectedTarget)) {
    invalid("WRONG_CHARACTER", "The captured character does not match the paired target.", 409);
  }

  if (isRecord(value.payload)) {
    const canonicalKey = Object.keys(value.payload).find((key) => CANONICAL_PAYLOAD_KEYS.has(key));
    if (canonicalKey) {
      invalid(
        "INVALID_CHARACTER_SOURCE_SHAPE",
        "The bridge payload must be an original Janitor source object, not a normalized or database-shaped record.",
        422,
      );
    }
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(value.payload)).byteLength;
  if (payloadBytes > MAX_MANUAL_CHARACTER_JSON_BYTES) {
    invalid("CHARACTER_PAYLOAD_TOO_LARGE", "The Janitor character payload must be 1 MiB or smaller.", 413);
  }
  let payload: JanitorCharacterResponse;
  try {
    payload = validateJanitorCharacterSource(value.payload);
  } catch (error) {
    if (error instanceof ManualJanitorImportError) {
      invalid("INVALID_SOURCE_PAYLOAD", "The captured Janitor character payload is invalid.", 422);
    }
    throw error;
  }
  if (payload.id?.toLowerCase() !== externalId) {
    invalid("WRONG_CHARACTER", "The captured character does not match the paired target.", 409);
  }
  return {
    bridgeVersion: 1,
    observerContractVersion: 1,
    messageId: value.messageId,
    platform: "JANITOR_AI",
    type: "CHARACTER",
    capturedAt,
    sourceUrl: value.source.url,
    payload,
  };
}

function invalid(code: string, message: string, status = 400): never {
  throw new BridgeError(code, message, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
