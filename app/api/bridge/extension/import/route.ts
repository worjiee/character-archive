import {
  BridgeError,
  bridgeErrorResponse,
  companionPreflight,
  readBoundedBridgeJson,
  receiveBridgeCharacter,
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
    const envelope = await readBoundedBridgeJson(request);
    const result = await receiveBridgeCharacter(
      token,
      envelope,
      new URL(request.url).origin,
      { capabilityOrigin: companionOrigin },
    );
    return withCompanionCors(
      request,
      Response.json({ jobId: result.jobId, previewJobId: result.previewJobId, status: "READY" }, { status: 202 }),
    );
  } catch (error) {
    return withCompanionCors(request, bridgeErrorResponse(error));
  }
}
