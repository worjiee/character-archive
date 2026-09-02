import { requireUserApiSession } from "@/src/lib/auth";
import { TagSearchInputError, parseTagSearchParams } from "../../../src/lib/tags/contracts";
import { searchCatalogTags } from "@/src/lib/tags/search";
import { ownerErrorResponse } from "../owner-errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const input = parseTagSearchParams(new URL(request.url).searchParams);
    const result = await searchCatalogTags(input);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof TagSearchInputError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return ownerErrorResponse(error);
  }
}
