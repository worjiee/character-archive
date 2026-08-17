import { DevelopmentFixtureError } from "../../../src/lib/importers/development";
import {
  JanitorNormalizationError,
  ManualJanitorImportError,
} from "../../../src/lib/importers/janitor";

export const MAX_IMPORT_REQUEST_BYTES = 2 * 1024 * 1024;
export type ImportMethod = "automatic-url" | "manual-json";

export interface ImportErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

export function getSourceUrl(body: unknown): string {
  if (!isRecord(body) || typeof body.url !== "string" || body.url.trim().length === 0) {
    throw new ImportRequestError("MISSING_SOURCE_URL", "A Janitor AI character URL is required.");
  }
  return body.url.trim();
}

export function getImportMethod(body: unknown): ImportMethod {
  if (!isRecord(body) || body.method === undefined) return "automatic-url";
  if (body.method !== "automatic-url" && body.method !== "manual-json") {
    throw new ImportRequestError("INVALID_IMPORT_METHOD", "A valid import method is required.");
  }
  return body.method;
}

export function getSourceJson(body: unknown): string {
  if (!isRecord(body) || typeof body.sourceJson !== "string" || body.sourceJson.trim().length === 0) {
    throw new ImportRequestError("MISSING_CHARACTER_JSON", "Janitor character JSON is required.");
  }
  return body.sourceJson;
}

export function importErrorResponse(error: unknown, persistence = false): Response {
  if (error instanceof ImportRequestError) {
    return jsonError(error.code, error.message, error.status);
  }

  if (error instanceof DevelopmentFixtureError) {
    const status = error.code === "FIXTURE_UNAVAILABLE" ? 404 : 503;
    return jsonError(error.code, error.message, status);
  }

  if (error instanceof JanitorNormalizationError) {
    return jsonError(error.code, error.message, 422);
  }

  if (error instanceof ManualJanitorImportError) {
    const status = error.code === "CHARACTER_JSON_TOO_LARGE" ? 413 :
      error.code === "INVALID_CHARACTER_RESPONSE" || error.code === "INVALID_CHARACTER_ID" || error.code === "MISSING_CHARACTER_NAME" ? 422 : 400;
    return jsonError(error.code, error.message, status);
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
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_REQUEST_BYTES) {
    throw new ImportRequestError(
      "IMPORT_PAYLOAD_TOO_LARGE",
      "Import requests must be 2 MB or smaller.",
      413,
    );
  }

  try {
    return JSON.parse(await readRequestText(request));
  } catch (error) {
    if (error instanceof ImportRequestError) throw error;
    throw new ImportRequestError("INVALID_REQUEST_JSON", "The request body must be valid JSON.");
  }
}

export class ImportRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ImportRequestError";
    this.code = code;
    this.status = status;
  }
}

async function readRequestText(request: Request): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_IMPORT_REQUEST_BYTES) {
      await reader.cancel();
      throw new ImportRequestError(
        "IMPORT_PAYLOAD_TOO_LARGE",
        "Import requests must be 2 MB or smaller.",
        413,
      );
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } } satisfies ImportErrorResponse, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
