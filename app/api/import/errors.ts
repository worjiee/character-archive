import { DevelopmentFixtureError } from "@/src/lib/importers/development";
import { JanitorNormalizationError } from "@/src/lib/importers/janitor";

export interface ImportErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export function getSourceUrl(body: unknown): string {
  if (!isRecord(body) || typeof body.url !== "string" || body.url.trim().length === 0) {
    throw new ImportRequestError("A Janitor AI character URL is required.");
  }
  return body.url.trim();
}

export function importErrorResponse(error: unknown, persistence = false): Response {
  if (error instanceof ImportRequestError) {
    return jsonError("INVALID_REQUEST", error.message, 400);
  }

  if (error instanceof DevelopmentFixtureError) {
    const status = error.code === "FIXTURE_UNAVAILABLE" ? 404 : 503;
    return jsonError(error.code, error.message, status);
  }

  if (error instanceof JanitorNormalizationError) {
    return jsonError(error.code, error.message, 422);
  }

  if (error instanceof TypeError) {
    return jsonError("INVALID_JANITOR_URL", error.message, 400);
  }

  console.error(persistence ? "Character persistence failed" : "Character preview failed", error);
  return jsonError(
    persistence ? "PERSISTENCE_FAILED" : "PREVIEW_FAILED",
    persistence
      ? "The character could not be saved. Please try again."
      : "The character preview could not be created. Please try again.",
    500,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ImportRequestError("The request body must be valid JSON.");
  }
}

class ImportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportRequestError";
  }
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } } satisfies ImportErrorResponse, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
