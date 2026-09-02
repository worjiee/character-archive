import {
  BridgeError,
  bridgeErrorResponse,
  bridgeReceiverPreflight,
  readBoundedBridgeJson,
  receiveBridgeCharacter,
  requireArchiveReceiverOrigin,
} from "@/src/lib/bridge";

export function OPTIONS(request: Request): Response { return bridgeReceiverPreflight(request); }

export async function POST(request: Request): Promise<Response> {
  try {
    requireArchiveReceiverOrigin(request);
    const token = request.headers.get("x-archive-bridge-token")?.trim();
    if (!token) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
    const envelope = await readBoundedBridgeJson(request);
    const archiveOrigin = new URL(request.url).origin;
    const result = await receiveBridgeCharacter(token, envelope, archiveOrigin, { capabilityOrigin: archiveOrigin });
    return Response.json({ jobId: result.jobId, previewJobId: result.previewJobId, status: "READY" }, { status: 202 });
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}
