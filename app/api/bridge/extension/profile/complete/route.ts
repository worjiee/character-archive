import {
  BridgeError,
  bridgeErrorResponse,
  companionPreflight,
  completeProfileTransfer,
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
    const token = request.headers.get("x-archive-bridge-token")?.trim();
    if (!token) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
    const result = await completeProfileTransfer(
      token,
      await readBoundedBridgeJson(request, 2 * 1024),
      new URL(request.url).origin,
      { capabilityOrigin: companionOrigin },
    );
    return withCompanionCors(request, Response.json(result, { status: 202 }));
  } catch (error) {
    return withCompanionCors(request, bridgeErrorResponse(error));
  }
}
