import {
  BridgeError,
  bridgeErrorResponse,
  bridgeExchangeRateLimiter,
  bridgeReceiverPreflight,
  bridgeRateLimitKey,
  exchangeBridgePairing,
  readBoundedBridgeJson,
  requireArchiveReceiverOrigin,
} from "@/src/lib/bridge";

export function OPTIONS(request: Request): Response { return bridgeReceiverPreflight(request); }

export async function POST(request: Request): Promise<Response> {
  try {
    requireArchiveReceiverOrigin(request);
    const key = bridgeRateLimitKey(request);
    const limit = bridgeExchangeRateLimiter.consume(key);
    if (limit.limited) {
      const response = bridgeErrorResponse(new BridgeError("PAIRING_RATE_LIMITED", "Too many pairing attempts.", 429));
      response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      return response;
    }
    const body = await readBoundedBridgeJson(request, 16 * 1024);
    const pairingCode = validateExchangeBody(body);
    const archiveOrigin = new URL(request.url).origin;
    const result = await exchangeBridgePairing(pairingCode, archiveOrigin, { capabilityOrigin: archiveOrigin });
    bridgeExchangeRateLimiter.clear(key);
    return Response.json(result);
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}

function validateExchangeBody(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key) => !["pairingCode", "bridgeVersion", "platform", "operation"].includes(key))) invalid();
  if (
    typeof body.pairingCode !== "string" ||
    body.bridgeVersion !== 1 ||
    body.platform !== "JANITOR_AI" ||
    body.operation !== "CHARACTER_IMPORT"
  ) invalid();
  return body.pairingCode;
}

function invalid(): never {
  throw new BridgeError("INVALID_PAIR_EXCHANGE", "The pairing exchange request is invalid.");
}
