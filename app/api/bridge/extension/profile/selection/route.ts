import { BridgeError, bridgeErrorResponse, companionPreflight, getProfileSelection, requireCompanionOrigin, withCompanionCors } from "@/src/lib/bridge";
export function OPTIONS(request: Request) { return companionPreflight(request); }
export async function POST(request: Request) {
  try {
    const companionOrigin = requireCompanionOrigin(request); const token = request.headers.get("x-archive-bridge-token")?.trim();
    if (!token) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
    return withCompanionCors(request, Response.json(await getProfileSelection(token, new URL(request.url).origin, { capabilityOrigin: companionOrigin })));
  } catch (error) { return withCompanionCors(request, bridgeErrorResponse(error)); }
}
