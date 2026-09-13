import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  getCharacterCollectionMemberships,
} from "@/src/lib/collections/custom-collections";
import { ownerErrorResponse } from "../../../owner-errors";

type Context = { params: Promise<{ characterId: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { characterId } = await context.params;
    const memberships = await getCharacterCollectionMemberships(session.principal, characterId);

    return Response.json(
      { memberships },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
