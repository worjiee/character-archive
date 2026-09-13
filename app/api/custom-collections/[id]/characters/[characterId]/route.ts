import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  CustomCollectionValidationError,
  setCharacterCollectionItem,
} from "@/src/lib/collections/custom-collections";
import { ownerErrorResponse, readOwnerJson } from "../../../../owner-errors";

type Context = { params: Promise<{ id: string; characterId: string }> };

export async function PUT(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { id: collectionId, characterId } = await context.params;
    const body = await readOwnerJson(request);

    if (typeof body.present !== "boolean") {
      throw new CustomCollectionValidationError("present must be a boolean.");
    }

    const result = await setCharacterCollectionItem(
      session.principal,
      collectionId,
      characterId,
      body.present
    );

    return Response.json(result);
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
