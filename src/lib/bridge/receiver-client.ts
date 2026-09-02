import {
  BRIDGE_CHANNEL_VERSION,
  JANITOR_PAGE_ORIGINS,
  validateJanitorReceiverMessage,
} from "./receiver-channel";

export type BridgeReceiverStatus =
  | { kind: "waiting"; message: string }
  | { kind: "ready"; message: string }
  | { kind: "pairing"; message: string }
  | { kind: "paired"; message: string }
  | { kind: "receiving"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; code: string; message: string };

export interface ReceiverWindowTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface ReceiverMessageEvent {
  origin: string;
  source: unknown;
  data: unknown;
}

export interface BridgeReceiverControllerOptions {
  channelNonce: string;
  expectedOpener: ReceiverWindowTarget;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onStatus(status: BridgeReceiverStatus): void;
}

export function createBridgeReceiverController({
  channelNonce,
  expectedOpener,
  fetchImpl = fetch,
  now = Date.now,
  onStatus,
}: BridgeReceiverControllerOptions) {
  let sourceOrigin: string | null = null;
  let bridgeToken: string | null = null;
  let expiresAt: string | null = null;
  let processing = false;
  let completed = false;

  function announce(): void {
    if (completed) return;
    if (bridgeToken && expiresAt && new Date(expiresAt).getTime() <= now()) {
      bridgeToken = null;
      expiresAt = null;
      completed = true;
      onStatus({ kind: "error", code: "BRIDGE_SESSION_EXPIRED", message: "Bridge session expired. Create a new pairing code and try again." });
      return;
    }

    if (sourceOrigin && bridgeToken && expiresAt) {
      send(sourceOrigin, {
        channelVersion: BRIDGE_CHANNEL_VERSION,
        type: "RECEIVER_PAIRED",
        channelNonce,
        expiresAt,
      });
      return;
    }

    const readyOrigins = sourceOrigin ? [sourceOrigin] : JANITOR_PAGE_ORIGINS;
    for (const origin of readyOrigins) {
      send(origin, {
        channelVersion: BRIDGE_CHANNEL_VERSION,
        type: "RECEIVER_READY",
        channelNonce,
      });
    }
  }

  async function handleMessage(event: ReceiverMessageEvent): Promise<boolean> {
    if (completed || !JANITOR_PAGE_ORIGINS.has(event.origin) || event.source !== expectedOpener) return false;
    const message = validateJanitorReceiverMessage(event.data);
    if (!message || message.channelNonce !== channelNonce || processing) return false;
    if (sourceOrigin && sourceOrigin !== event.origin) return false;

    processing = true;
    try {
      if (message.type === "CHANNEL_OPEN") {
        const firstAcknowledgement = sourceOrigin === null;
        sourceOrigin = event.origin;
        if (firstAcknowledgement) {
          onStatus({ kind: "ready", message: "Ready. Enter the one-time pairing code below." });
        }
      } else {
        await relayCharacter(message.envelope, event.origin);
      }
      return true;
    } finally {
      processing = false;
    }
  }

  function dispose(): void {
    bridgeToken = null;
    expiresAt = null;
    sourceOrigin = null;
    completed = true;
  }

  async function pair(pairingCode: string): Promise<boolean> {
    if (completed) return false;
    if (!sourceOrigin) {
      onStatus({
        kind: "error",
        code: "INITIALIZATION_TIMEOUT",
        message: "The Janitor bridge channel has not finished initializing.",
      });
      return false;
    }
    if (bridgeToken) return true;
    if (!isPairingCode(pairingCode)) {
      onStatus({ kind: "error", code: "INVALID_PAIRING", message: "Enter a valid one-time pairing code." });
      return false;
    }
    if (processing) return false;
    processing = true;
    try {
      return await exchangePairing(pairingCode, sourceOrigin);
    } finally {
      processing = false;
    }
  }

  async function exchangePairing(pairingCode: string, origin: string): Promise<boolean> {
    onStatus({ kind: "pairing", message: "Pairing with Character Archive…" });
    try {
      const response = await fetchImpl("/api/bridge/pair/exchange", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingCode,
          bridgeVersion: 1,
          platform: "JANITOR_AI",
          operation: "CHARACTER_IMPORT",
        }),
      });
      const body = await readResponseObject(response);
      if (
        !response.ok ||
        typeof body.bridgeToken !== "string" ||
        !/^[A-Za-z0-9_-]{43}$/u.test(body.bridgeToken) ||
        typeof body.expiresAt !== "string" ||
        !Number.isFinite(new Date(body.expiresAt).getTime())
      ) {
        const errorCode = safeErrorCode(body) ?? "PAIRING_FAILED";
        onStatus({ kind: "error", code: errorCode, message: pairingErrorMessage(errorCode) });
        send(origin, pairResult(channelNonce, false, null, errorCode));
        return false;
      }

      // The scoped capability intentionally remains inside this Archive-origin closure.
      bridgeToken = body.bridgeToken;
      expiresAt = body.expiresAt;
      onStatus({ kind: "paired", message: "Paired. Waiting for the selected Janitor character…" });
      send(origin, pairResult(channelNonce, true, expiresAt, null));
      return true;
    } catch {
      onStatus({ kind: "error", code: "PAIRING_FAILED", message: "Pairing could not reach Character Archive." });
      send(origin, pairResult(channelNonce, false, null, "PAIRING_FAILED"));
      return false;
    }
  }

  async function relayCharacter(envelope: Record<string, unknown>, origin: string): Promise<void> {
    if (!bridgeToken || !expiresAt || sourceOrigin !== origin) {
      send(origin, importResult(channelNonce, false, "BRIDGE_NOT_PAIRED"));
      return;
    }
    if (new Date(expiresAt).getTime() <= now()) {
      bridgeToken = null;
      expiresAt = null;
      completed = true;
      onStatus({ kind: "error", code: "BRIDGE_SESSION_EXPIRED", message: "Bridge session expired. Create a new pairing code and try again." });
      send(origin, importResult(channelNonce, false, "BRIDGE_SESSION_EXPIRED"));
      return;
    }

    const characterName = characterNameFromEnvelope(envelope);
    onStatus({
      kind: "receiving",
      message: characterName ? `Receiving ${characterName}…` : "Receiving character…",
    });
    try {
      const response = await fetchImpl("/api/bridge/import", {
        method: "POST",
        credentials: "omit",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Archive-Bridge-Token": bridgeToken,
        },
        body: JSON.stringify(envelope),
      });
      const body = await readResponseObject(response);
      if (!response.ok) {
        const errorCode = safeErrorCode(body) ?? "PAYLOAD_REJECTED";
        onStatus({ kind: "error", code: errorCode, message: importErrorMessage(errorCode) });
        send(origin, importResult(channelNonce, false, errorCode));
        return;
      }

      bridgeToken = null;
      expiresAt = null;
      completed = true;
      onStatus({
        kind: "success",
        message: "Received successfully. You may return to Character Archive.",
      });
      send(origin, importResult(channelNonce, true, null));
    } catch {
      onStatus({ kind: "error", code: "BRIDGE_TRANSPORT_FAILED", message: "The character could not be relayed to Character Archive." });
      send(origin, importResult(channelNonce, false, "BRIDGE_TRANSPORT_FAILED"));
    }
  }

  function send(targetOrigin: string, message: unknown): void {
    expectedOpener.postMessage(message, targetOrigin);
  }

  return { announce, handleMessage, pair, dispose };
}

function isPairingCode(value: string): boolean {
  if (value.length > 32 || !/^[0-9a-f\s-]+$/iu.test(value)) return false;
  return /^[0-9a-f]{16}$/iu.test(value.replace(/[\s-]/gu, ""));
}

function pairResult(channelNonce: string, ok: boolean, expiresAt: string | null, errorCode: string | null) {
  return ok
    ? { channelVersion: 1, type: "PAIR_RESULT", channelNonce, ok: true, expiresAt }
    : { channelVersion: 1, type: "PAIR_RESULT", channelNonce, ok: false, errorCode };
}

function importResult(channelNonce: string, ok: boolean, errorCode: string | null) {
  return ok
    ? { channelVersion: 1, type: "IMPORT_RESULT", channelNonce, ok: true }
    : { channelVersion: 1, type: "IMPORT_RESULT", channelNonce, ok: false, errorCode };
}

async function readResponseObject(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function safeErrorCode(body: Record<string, unknown>): string | null {
  if (!isRecord(body.error) || typeof body.error.code !== "string") return null;
  return /^[A-Z0-9_]{2,64}$/u.test(body.error.code) ? body.error.code : null;
}

function characterNameFromEnvelope(envelope: Record<string, unknown>): string | null {
  if (!isRecord(envelope.payload) || typeof envelope.payload.name !== "string") return null;
  const name = envelope.payload.name.trim();
  return name ? name.slice(0, 80) : null;
}

function pairingErrorMessage(code: string): string {
  if (code === "PAIRING_EXPIRED") return "Pairing expired. Create a new pairing code and try again.";
  if (code === "INVALID_PAIRING") return "Invalid pairing code.";
  if (code === "PAIRING_ALREADY_USED") return "This pairing code was already used.";
  return "Pairing failed. Create a new pairing code and try again.";
}

function importErrorMessage(code: string): string {
  if (code === "BRIDGE_SESSION_EXPIRED") return "Bridge session expired. Create a new pairing code and try again.";
  return "Payload rejected. Return to Character Archive for details.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
