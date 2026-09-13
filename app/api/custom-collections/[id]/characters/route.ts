import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  browseUserCollectionCharacters,
} from "@/src/lib/collections/custom-collections";
import { ownerErrorResponse } from "../../../owner-errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { id } = await context.params;
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || undefined;
    const sortRaw = url.searchParams.get("sort");
    const sort = sortRaw === "freshest" || sortRaw === "name" || sortRaw === "added" ? sortRaw : "added";
    const page = parseInt(url.searchParams.get("page") || "1", 10);
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    const result = await browseUserCollectionCharacters(session.principal, id, {
      query,
      sort,
      page,
      limit,
    });

    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
