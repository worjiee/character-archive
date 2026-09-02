import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  addCharactersToCart,
  assertCharacterCollectionInputKeys,
  parseCharacterIds,
} from "@/src/lib/characters/collections";
import { ownerErrorResponse, readOwnerJson } from "../../owner-errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await readOwnerJson(request);
    assertCharacterCollectionInputKeys(body, ["characterIds"]);
    const characterIds = parseCharacterIds(body.characterIds);
    const result = await addCharactersToCart(session.principal, characterIds);
    return Response.json(result);
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
