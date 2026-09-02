import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  assertCharacterCollectionInputKeys,
  parseCharacterCollectionKind,
  parseCharacterCollectionPresence,
  setCharacterCollectionMembership,
} from "@/src/lib/characters/collections";
import { ownerErrorResponse, readOwnerJson } from "../../../owner-errors";

type Context = { params: Promise<{ collection: string; id: string }> };

export async function PUT(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const { collection: rawCollection, id } = await context.params;
    const collection = parseCharacterCollectionKind(rawCollection);
    const body = await readOwnerJson(request);
    assertCharacterCollectionInputKeys(body, ["present"]);
    const present = parseCharacterCollectionPresence(body.present);
    const result = await setCharacterCollectionMembership(session.principal, collection, id, present);
    return Response.json(result);
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
