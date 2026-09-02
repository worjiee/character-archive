import { requireUserApiSession } from "@/src/lib/auth";
import { searchAuthorTags } from "@/src/lib/authors/browse";
import { AuthorTagSearchInputError, parseAuthorTagSearchParams } from "../../../../../../src/lib/authors/contracts";
import { parseAuthorIdentity } from "../../../../../../src/lib/authors/params";
import { ownerErrorResponse } from "../../../../owner-errors";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string; creatorId: string }> },
): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const route = await params;
    const identity = parseAuthorIdentity(route.platform, route.creatorId);
    if (!identity) return Response.json({ error: "Author not found." }, { status: 404 });
    const input = parseAuthorTagSearchParams(new URL(request.url).searchParams);
    const result = await searchAuthorTags(identity, input);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AuthorTagSearchInputError) return Response.json({ error: error.message }, { status: 400 });
    return ownerErrorResponse(error);
  }
}
