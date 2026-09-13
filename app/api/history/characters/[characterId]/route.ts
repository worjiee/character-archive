import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { removeCharacterView } from "@/src/lib/history/service";
import { ownerErrorResponse } from "../../../owner-errors";

type Context = { params: Promise<{ characterId: string }> };

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const { characterId } = await context.params;
    await removeCharacterView(session.principal, characterId);
    return Response.json({ success: true });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}