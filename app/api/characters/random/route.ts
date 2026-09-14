import { getAuthenticatedUserApiSession, requireUserApiSession } from "../../../../src/lib/auth";
import { parseCharacterBrowseParams, searchParamsToBrowseParams } from "../../../../src/lib/archive/browse-params";
import { getRandomCharacter } from "../../../../src/lib/characters/browse";
import { ownerErrorResponse } from "../../owner-errors";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

  try {
    const url = new URL(request.url);
    const browseParams = searchParamsToBrowseParams(url.searchParams);
    const filters = parseCharacterBrowseParams(browseParams);
    const excludeId = url.searchParams.get("excludeId")?.trim() || undefined;

    const result = await getRandomCharacter(filters, session.principal, { excludeId });

    return Response.json(
      result,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
