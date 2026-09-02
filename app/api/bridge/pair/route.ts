import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { bridgeErrorResponse, createBridgePairing, readBoundedBridgeJson } from "@/src/lib/bridge";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const archiveOrigin = new URL(request.url).origin;
    const body = await readBoundedBridgeJson(request, 8 * 1024);
    return Response.json(
      await createBridgePairing(session.sessionId, archiveOrigin, body),
      { status: 201 },
    );
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}
