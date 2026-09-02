import { BridgeError, bridgeErrorResponse, companionPreflight, readBoundedBridgeJson, receiveProfileDiscovery, requireCompanionOrigin, withCompanionCors } from "@/src/lib/bridge";
export function OPTIONS(request: Request) { return companionPreflight(request); }
export async function POST(request: Request) {
  try {
    const companionOrigin = requireCompanionOrigin(request); const token = request.headers.get("x-archive-bridge-token")?.trim();
    if (!token) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
    const result = await receiveProfileDiscovery(token, await readBoundedBridgeJson(request, 128 * 1024), new URL(request.url).origin, { capabilityOrigin: companionOrigin });
    return withCompanionCors(request, Response.json(result, { status: 202 }));
  } catch (error) { return withCompanionCors(request, bridgeErrorResponse(error)); }
}
