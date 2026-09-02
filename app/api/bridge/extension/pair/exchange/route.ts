import {
  BridgeError,
  bridgeErrorResponse,
  bridgeExchangeRateLimiter,
  bridgeRateLimitKey,
  companionPreflight,
  exchangeBridgePairing,
  readBoundedBridgeJson,
  requireCompanionOrigin,
  withCompanionCors,
} from "@/src/lib/bridge";

export function OPTIONS(request: Request): Response {
  return companionPreflight(request);
}

export async function POST(request: Request): Promise<Response> {
  try {
    const companionOrigin = requireCompanionOrigin(request);
    const key = bridgeRateLimitKey(request);
    const limit = bridgeExchangeRateLimiter.consume(key);
    if (limit.limited) {
      const response = bridgeErrorResponse(
        new BridgeError("PAIRING_RATE_LIMITED", "Too many pairing attempts.", 429),
      );
      response.headers.set("Retry-After", String(limit.retryAfterSeconds));
      return withCompanionCors(request, response);
    }
    const body = await readBoundedBridgeJson(request, 16 * 1024);
    const exchange = validateExchangeBody(body);
    const result = await exchangeBridgePairing(exchange.pairingCode, new URL(request.url).origin, {
      capabilityOrigin: companionOrigin,
      presentedTarget: exchange.target,
    });
    bridgeExchangeRateLimiter.clear(key);
    return withCompanionCors(request, Response.json(result));
  } catch (error) {
    return withCompanionCors(request, bridgeErrorResponse(error));
  }
}

function validateExchangeBody(value: unknown): { pairingCode: string; target: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const body = value as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.length !== 4 || keys.some((key) => !["pairingCode", "bridgeVersion", "operation", "target"].includes(key))) invalid();
  if (
    typeof body.pairingCode !== "string" ||
    body.bridgeVersion !== 1 ||
    body.operation !== "CHARACTER_IMPORT" ||
    !body.target
  ) invalid();
  return { pairingCode: body.pairingCode, target: body.target };
}

function invalid(): never {
  throw new BridgeError("INVALID_PAIR_EXCHANGE", "The pairing exchange request is invalid.");
}
