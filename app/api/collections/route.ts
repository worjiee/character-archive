import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  assertCharacterCollectionInputKeys,
  getCharacterCollectionState,
} from "@/src/lib/characters/collections";
import { ownerErrorResponse } from "../owner-errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    assertCharacterCollectionInputKeys(Object.fromEntries(new URL(request.url).searchParams), []);
    const collections = await getCharacterCollectionState(session.principal);
    return Response.json(
      { collections },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
