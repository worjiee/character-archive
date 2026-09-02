export const BRIDGE_CHANNEL_VERSION = 1 as const;
export const BRIDGE_RECEIVER_PATH = "/bridge/receiver";
export const BRIDGE_CHANNEL_NONCE_PATTERN = /^[0-9a-f]{32}$/u;
export const JANITOR_PAGE_ORIGINS = new Set([
  "https://janitorai.com",
  "https://www.janitorai.com",
]);

const CHANNEL_OPEN_KEYS = new Set([
  "channelVersion",
  "type",
  "channelNonce",
]);
const CHARACTER_MESSAGE_KEYS = new Set([
  "channelVersion",
  "type",
  "channelNonce",
  "envelope",
]);
const ENVELOPE_KEYS = new Set([
  "bridgeVersion",
  "messageId",
  "platform",
  "type",
  "capturedAt",
  "source",
  "payload",
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_PAYLOAD_KEYS = new Set([
  "externalId",
  "sourceUrl",
  "rawData",
  "greetings",
  "lorebookReferences",
  "exampleDialogs",
  "avatarUrl",
]);

export type JanitorReceiverMessage =
  | {
      channelVersion: 1;
      type: "CHANNEL_OPEN";
      channelNonce: string;
    }
  | {
      channelVersion: 1;
      type: "CHARACTER_ENVELOPE";
      channelNonce: string;
      envelope: Record<string, unknown>;
    };

export function readBridgeChannelNonce(hash: string): string | null {
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const nonce = parameters.get("channel");
  return nonce && BRIDGE_CHANNEL_NONCE_PATTERN.test(nonce) ? nonce : null;
}

export type BridgeReceiverInitialization =
  | { ok: true; channelNonce: string }
  | { ok: false; code: "NO_OPENER" | "MISSING_CHANNEL" | "INVALID_CHANNEL"; message: string };

export function inspectBridgeReceiverInitialization(
  hash: string,
  hasOpener: boolean,
): BridgeReceiverInitialization {
  if (!hasOpener) {
    return {
      ok: false,
      code: "NO_OPENER",
      message: "Open this receiver from the Janitor bridge.",
    };
  }
  const parameters = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const nonce = parameters.get("channel");
  if (!nonce) {
    return {
      ok: false,
      code: "MISSING_CHANNEL",
      message: "The receiver URL is missing its bridge channel.",
    };
  }
  if (!BRIDGE_CHANNEL_NONCE_PATTERN.test(nonce)) {
    return {
      ok: false,
      code: "INVALID_CHANNEL",
      message: "The receiver URL contains an invalid bridge channel.",
    };
  }
  return { ok: true, channelNonce: nonce };
}

export function validateJanitorReceiverMessage(value: unknown): JanitorReceiverMessage | null {
  if (!isRecord(value) || value.channelVersion !== BRIDGE_CHANNEL_VERSION) return null;
  if (typeof value.channelNonce !== "string" || !BRIDGE_CHANNEL_NONCE_PATTERN.test(value.channelNonce)) {
    return null;
  }

  if (value.type === "CHANNEL_OPEN") {
    if (!hasOnlyKeys(value, CHANNEL_OPEN_KEYS)) return null;
    return {
      channelVersion: BRIDGE_CHANNEL_VERSION,
      type: "CHANNEL_OPEN",
      channelNonce: value.channelNonce,
    };
  }

  if (value.type === "CHARACTER_ENVELOPE") {
    if (!hasOnlyKeys(value, CHARACTER_MESSAGE_KEYS) || !isBridgeEnvelopeShape(value.envelope)) return null;
    return {
      channelVersion: BRIDGE_CHANNEL_VERSION,
      type: "CHARACTER_ENVELOPE",
      channelNonce: value.channelNonce,
      envelope: value.envelope,
    };
  }

  return null;
}

function isBridgeEnvelopeShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || !hasOnlyKeys(value, ENVELOPE_KEYS)) return false;
  if (
    value.bridgeVersion !== 1 ||
    value.platform !== "JANITOR_AI" ||
    value.type !== "CHARACTER" ||
    typeof value.messageId !== "string" ||
    !UUID_V4.test(value.messageId) ||
    typeof value.capturedAt !== "string" ||
    !Number.isFinite(new Date(value.capturedAt).getTime()) ||
    !isRecord(value.source) ||
    Object.keys(value.source).length !== 1 ||
    typeof value.source.url !== "string" ||
    !isRecord(value.payload) ||
    typeof value.payload.id !== "string" ||
    !UUID_V4.test(value.payload.id) ||
    typeof value.payload.name !== "string" ||
    !value.payload.name.trim() ||
    Object.keys(value.payload).some((key) => CANONICAL_PAYLOAD_KEYS.has(key))
  ) {
    return false;
  }

  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
