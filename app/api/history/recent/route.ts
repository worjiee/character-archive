import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { getRecentViews } from "@/src/lib/history/service";
import { ownerErrorResponse } from "../../owner-errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : 6;

    const items = await getRecentViews(session.principal, isNaN(limit) ? 6 : limit);
    return Response.json(
      { items },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
}