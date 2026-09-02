import {
  CharacterManagementValidationError,
  clearCharacterOverrides,
  restoreDeletedCharacter,
  setManagedCharacterStatus,
  softDeleteCharacter,
  updateCharacterOverrides,
} from "@/src/lib/characters/management";
import { getAuthenticatedUserApiSession, requireAdminApiSession, requireUserApiSession } from "@/src/lib/auth";
import { getCharacterQuickView } from "@/src/lib/characters/browse";
import { ownerErrorResponse, readOwnerJson } from "../../owner-errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const character = await getCharacterQuickView(id, session.principal);
    if (!character) return Response.json({ error: { code: "NOT_FOUND", message: "Character not found." } }, { status: 404 });
    return Response.json({ character });
  } catch (error) {
    console.error("Character preview failed", error);
    return Response.json({ error: { code: "PREVIEW_FAILED", message: "The character preview could not be loaded." } }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const body = await readOwnerJson(request);
    if (body.action === "update-overrides") {
      await updateCharacterOverrides(id, {
        name: body.name,
        description: body.description,
        personality: body.personality,
        scenario: body.scenario,
        avatarUrl: body.avatarUrl,
      });
    } else if (body.action === "reset-overrides") {
      await clearCharacterOverrides(id);
    } else if (body.action === "status") {
      await setManagedCharacterStatus(id, body.status);
    } else if (body.action === "restore") {
      await restoreDeletedCharacter(id);
    } else {
      throw new CharacterManagementValidationError("Unknown character action.");
    }
    return Response.json({ success: true });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    await softDeleteCharacter(id);
    return Response.json({ success: true });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
