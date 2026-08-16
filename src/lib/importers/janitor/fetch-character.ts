import { isValidJanitorCharacterId } from "./parse-url";
import type { JanitorCharacterResponse } from "./types";

const JANITOR_AI_BASE_URL = "https://janitorai.com";
const JANITOR_CHARACTER_ENDPOINT = "/hampter/characters";
const DEFAULT_TIMEOUT_MS = 10_000;

export type JanitorRetrievalErrorCode =
  | "INVALID_CHARACTER_ID"
  | "NOT_FOUND"
  | "ACCESS_DENIED"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "SOURCE_ID_MISMATCH";

export class JanitorRetrievalError extends Error {
  readonly code: JanitorRetrievalErrorCode;
  readonly status?: number;

  constructor(
    code: JanitorRetrievalErrorCode,
    message: string,
    metadata: { status?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: metadata.cause });
    this.name = "JanitorRetrievalError";
    this.code = code;
    this.status = metadata.status;
  }
}

export type JanitorFetch = typeof globalThis.fetch;

export interface FetchJanitorCharacterOptions {
  fetch?: JanitorFetch;
  timeoutMs?: number;
}

export async function fetchJanitorCharacter(
  characterId: string,
  options: FetchJanitorCharacterOptions = {},
): Promise<JanitorCharacterResponse> {
  if (!isValidJanitorCharacterId(characterId)) {
    throw new JanitorRetrievalError(
      "INVALID_CHARACTER_ID",
      "Janitor AI character ID must be a valid UUID.",
    );
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImplementation(buildCharacterEndpoint(characterId), {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal: controller.signal,
    });

    assertSuccessfulStatus(response);

    if (!isJsonResponse(response)) {
      throw new JanitorRetrievalError(
        "INVALID_RESPONSE",
        "Janitor AI returned a non-JSON response.",
        { status: response.status },
      );
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (cause) {
      throw new JanitorRetrievalError(
        "INVALID_RESPONSE",
        "Janitor AI returned malformed JSON.",
        { status: response.status, cause },
      );
    }

    return validateCharacterResponse(payload, characterId, response.status);
  } catch (error) {
    if (error instanceof JanitorRetrievalError) throw error;

    if (timedOut) {
      throw new JanitorRetrievalError("TIMEOUT", "Janitor AI request timed out.", {
        cause: error,
      });
    }

    throw new JanitorRetrievalError("UPSTREAM_ERROR", "Janitor AI request failed.", {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildCharacterEndpoint(characterId: string): string {
  return `${JANITOR_AI_BASE_URL}${JANITOR_CHARACTER_ENDPOINT}/${encodeURIComponent(characterId)}`;
}

function assertSuccessfulStatus(response: Response): void {
  const status = response.status;

  if (status === 200) return;

  if (status === 401 || status === 403) {
    throw new JanitorRetrievalError("ACCESS_DENIED", "Access to this character was denied.", {
      status,
    });
  }

  if (status === 404) {
    throw new JanitorRetrievalError("NOT_FOUND", "Janitor AI character was not found.", {
      status,
    });
  }

  if (status === 429) {
    throw new JanitorRetrievalError("RATE_LIMITED", "Janitor AI rate-limited the request.", {
      status,
    });
  }

  throw new JanitorRetrievalError("UPSTREAM_ERROR", "Janitor AI returned an error response.", {
    status,
  });
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/json") || contentType.includes("+json");
}

function validateCharacterResponse(
  payload: unknown,
  requestedId: string,
  status: number,
): JanitorCharacterResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new JanitorRetrievalError(
      "INVALID_RESPONSE",
      "Janitor AI character response must be an object.",
      { status },
    );
  }

  const response = payload as JanitorCharacterResponse;

  if (typeof response.id !== "string" || !isValidJanitorCharacterId(response.id)) {
    throw new JanitorRetrievalError(
      "INVALID_RESPONSE",
      "Janitor AI character response is missing a valid ID.",
      { status },
    );
  }

  if (typeof response.name !== "string" || response.name.trim().length === 0) {
    throw new JanitorRetrievalError(
      "INVALID_RESPONSE",
      "Janitor AI character response is missing a valid name.",
      { status },
    );
  }

  if (response.id.toLowerCase() !== requestedId.toLowerCase()) {
    throw new JanitorRetrievalError(
      "SOURCE_ID_MISMATCH",
      "Janitor AI response ID does not match the requested character ID.",
      { status },
    );
  }

  return response;
}
