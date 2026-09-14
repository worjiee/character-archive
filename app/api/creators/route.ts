import { getAuthenticatedUserApiSession, requireUserApiSession } from "../../../src/lib/auth";
import { browseAuthors } from "../../../src/lib/authors/browse";
import { formatCreatorParam } from "../../../src/lib/authors/params";
import { ownerErrorResponse } from "../owner-errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit ? Math.min(Math.max(1, Number(rawLimit) || 20), 50) : 20;

    const result = await browseAuthors(
      {
        query,
        source: "ALL",
        sort: "characters-desc",
        favoriteOnly: false,
        page: 1,
        pageSize: limit,
      },
      session.principal,
    );

    const creators = result.items.map((item) => ({
      key: formatCreatorParam(item.identity),
      name: item.creatorName,
      platform: item.identity.platform,
      characterCount: Number(item.characterCount),
      identity: item.identity,
    }));

    return Response.json(
      { items: creators },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
