import {
  ModerationConflictError,
  ModerationNotFoundError,
  ModerationValidationError,
} from "@/src/lib/moderation";

export async function readModerationJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ModerationValidationError("The request body must be an object.");
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ModerationValidationError) throw error;
    throw new ModerationValidationError("The request body must be valid JSON.");
  }
}

export function moderationErrorResponse(error: unknown): Response {
  if (error instanceof ModerationValidationError) return errorResponse("INVALID_REQUEST", error.message, 400);
  if (error instanceof ModerationConflictError) return errorResponse("CONFLICT", error.message, 409);
  if (error instanceof ModerationNotFoundError) return errorResponse("NOT_FOUND", error.message, 404);
  console.error("Moderation operation failed", error);
  return errorResponse("MODERATION_FAILED", "The moderation operation could not be completed.", 500);
}

export function requireRouteId(id: string): string {
  const value = id.trim();
  if (!value) throw new ModerationValidationError("A record ID is required.");
  return value;
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}
