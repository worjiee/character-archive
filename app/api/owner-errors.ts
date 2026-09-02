import {
  CharacterManagementNotFoundError,
  CharacterManagementValidationError,
} from "@/src/lib/characters/management";
import {
  CharacterCollectionNotFoundError,
  CharacterCollectionValidationError,
} from "@/src/lib/characters/collections";
import { SettingsValidationError } from "@/src/lib/settings";

export async function readOwnerJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new CharacterManagementValidationError("The request body must be an object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof CharacterManagementValidationError) throw error;
    throw new CharacterManagementValidationError("The request body must be valid JSON.");
  }
}

export function ownerErrorResponse(error: unknown): Response {
  if (error instanceof CharacterManagementValidationError || error instanceof CharacterCollectionValidationError || error instanceof SettingsValidationError) {
    return Response.json({ error: { code: "INVALID_REQUEST", message: error.message } }, { status: 400 });
  }
  if (error instanceof CharacterManagementNotFoundError || error instanceof CharacterCollectionNotFoundError) {
    return Response.json({ error: { code: "NOT_FOUND", message: error.message } }, { status: 404 });
  }
  console.error("Owner operation failed", error);
  return Response.json({ error: { code: "OWNER_OPERATION_FAILED", message: "The operation could not be completed." } }, { status: 500 });
}
