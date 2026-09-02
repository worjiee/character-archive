import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { bridgeErrorResponse, cancelBridgeJob, getBridgeJob } from "@/src/lib/bridge";

export async function GET(request: Request, context: RouteContext<"/api/bridge/jobs/[id]">): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    return Response.json({ job: await getBridgeJob(session.sessionId, (await context.params).id) });
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext<"/api/bridge/jobs/[id]">): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    await cancelBridgeJob(session.sessionId, (await context.params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return bridgeErrorResponse(error);
  }
}
