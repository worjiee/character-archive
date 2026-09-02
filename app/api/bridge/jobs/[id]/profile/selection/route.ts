import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { bridgeErrorResponse, readBoundedBridgeJson, selectProfileCharacters } from "@/src/lib/bridge";
export async function POST(request: Request, context: RouteContext<"/api/bridge/jobs/[id]/profile/selection">) {
  const unauthorized = await requireUserApiSession(request); if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request); if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try { return Response.json({ profile: await selectProfileCharacters(session.sessionId, (await context.params).id, await readBoundedBridgeJson(request, 16 * 1024)) }); }
  catch (error) { return bridgeErrorResponse(error); }
}
