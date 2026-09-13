import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { recordCharacterView } from "@/src/lib/history/service";
import { ownerErrorResponse, readOwnerJson } from "../../owner-errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await readOwnerJson(request);
    const characterId = typeof body.characterId === "string" ? body.characterId.trim() : "";

    const result = await recordCharacterView(session.principal, characterId);
    return Response.json({ success: true, ...result });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}