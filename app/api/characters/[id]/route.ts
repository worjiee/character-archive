import {
  CharacterManagementValidationError,
  clearCharacterOverrides,
  restoreDeletedCharacter,
  setManagedCharacterStatus,
  softDeleteCharacter,
  updateCharacterOverrides,
} from "@/src/lib/characters/management";
import { requireOwnerApiSession } from "@/src/lib/auth";
import { ownerErrorResponse, readOwnerJson } from "../../owner-errors";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireOwnerApiSession(request);
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
  const unauthorized = await requireOwnerApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    await softDeleteCharacter(id);
    return Response.json({ success: true });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
