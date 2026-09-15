import {
  CharacterManagementValidationError,
  reorderGreetings,
  setGreetingVisibility,
} from "@/src/lib/characters/management";
import { getAuthenticatedUserApiSession, requireAdminApiSession } from "@/src/lib/auth";
import { ownerErrorResponse, readOwnerJson } from "../../../owner-errors";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const session = await getAuthenticatedUserApiSession(request);
    const userId = session?.principal?.userId;
    const body = await readOwnerJson(request);
    if (body.action === "reorder") {
      await reorderGreetings(id, body.greetingIds, undefined, userId);
    } else if (body.action === "visibility" && typeof body.greetingId === "string") {
      await setGreetingVisibility(id, body.greetingId, body.hidden, undefined, userId);
    } else {
      throw new CharacterManagementValidationError("Unknown greeting action.");
    }
    return Response.json({ success: true });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
