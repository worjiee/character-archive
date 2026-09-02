import { artworkResponse, readPreparedArtwork } from "@/src/lib/artwork/index";
import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { getFallbackReviewArtworkBinding } from "@/src/lib/importers/fallback-review";
import { importErrorResponse } from "../../../../errors";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const binding = getFallbackReviewArtworkBinding(session.sessionId, (await context.params).id);
    const bytes = await readPreparedArtwork(binding);
    if (!bytes) return new Response(null, { status: 404 });
    return artworkResponse(bytes, { etag: binding.sha256, pending: true, request });
  } catch (error) {
    return importErrorResponse(error, true);
  }
}
