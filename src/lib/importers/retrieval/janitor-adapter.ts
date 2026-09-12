import { normalizeJanitorCharacter } from "../janitor/normalize";
import { canonicalJanitorCharacterUrl, JANITOR_HOSTNAMES } from "../janitor/parse-url";
import { normalizeStrictUuid, normalizeUuidPrefix } from "../source-identifiers";
import type { JanitorCharacterResponse } from "../janitor/types";
import type { SourceAdapter } from "./adapter";
import { SafeFetchError, safeFetchText } from "./safe-fetch";
import type {
  BatchProfilePage,
  ParseTargetResult,
  RetrievalOptions,
  RetrievedCharacterResult,
  RetrievedLorebookResult,
  SourceCapabilities,
  SourceTarget,
} from "./types";

const JANITOR_AI_BASE_URL = "https://janitorai.com";
const JANITOR_CHARACTER_ENDPOINT = "/hampter/characters";
const JANITOR_ACCEPT = "application/json, text/plain, */*";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface JanitorRequestDiagnostic {
  method: "GET";
  hostname: string;
  pathname: string;
  accept: string;
  authorizationPresent: boolean;
  authorizationScheme: "Bearer" | "Other" | "None";
  authorizationLength: number;
  redirect: "manual";
}

export interface JanitorResponseDiagnostic {
  status: number;
  contentType: string | null;
}

export function createJanitorRequestDiagnostic(
  endpoint: string,
  headers: Readonly<Record<string, string>>,
): JanitorRequestDiagnostic {
  const url = new URL(endpoint);
  const authorization = headers.Authorization;
  const scheme = authorization?.match(/^([^\s]+)/)?.[1];

  return {
    method: "GET",
    hostname: url.hostname,
    pathname: url.pathname,
    accept: headers.Accept,
    authorizationPresent: Boolean(authorization),
    authorizationScheme: scheme
      ? scheme.toLowerCase() === "bearer"
        ? "Bearer"
        : "Other"
      : "None",
    authorizationLength: authorization?.length ?? 0,
    redirect: "manual",
  };
}

export function createJanitorResponseDiagnostic(
  response: Pick<Response, "status" | "headers">,
): JanitorResponseDiagnostic {
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
  };
}

function diagnosticsEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.JANITOR_REQUEST_DIAGNOSTICS === "1"
  );
}

const REJECTED_KEYS = new Set([
  "authorization",
  "bearer",
  "bearertoken",
  "headers",
  "cookie",
  "cookies",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "session",
  "sessionid",
  "sessiontoken",
  "token",
  "password",
  "apikey",
  "clientsecret",
  "secretkey",
  "localstorage",
  "sessionstorage",
]);

function rejectCredentialShapedData(root: Record<string, unknown>): void {
  const pending: unknown[] = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    if (!current || typeof current !== "object") continue;

    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      const normalizedKey = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (REJECTED_KEYS.has(normalizedKey)) {
        throw new Error(
          "Credential, session, cookie, or browser-storage data is not accepted. Only character data is allowed.",
        );
      }
      if (typeof value === "object" && value !== null) pending.push(value);
    }
  }
}

function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  const parsedSeconds = parseInt(trimmed, 10);
  if (!Number.isNaN(parsedSeconds) && Number.isFinite(parsedSeconds)) {
    return Math.min(Math.max(0, parsedSeconds), 300);
  }
  const parsedDate = new Date(trimmed).getTime();
  if (Number.isFinite(parsedDate)) {
    const diffSeconds = Math.ceil((parsedDate - Date.now()) / 1000);
    return Math.min(Math.max(0, diffSeconds), 300);
  }
  return undefined;
}

export class JanitorSourceAdapter implements SourceAdapter {
  readonly platform = "JANITOR_AI" as const;

  readonly capabilities: SourceCapabilities = {
    singleCharacter: true,
    creatorProfile: false,
    lorebooks: false,
    sourceTimestamps: true,
    authenticatedRetrieval: false,
    publicRetrieval: true,
    persistedPlatform: true,
  };

  parseTarget(input: string): ParseTargetResult {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        success: false,
        error: "Target input cannot be empty.",
        code: "INVALID_URL",
      };
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmed);
    } catch {
      return {
        success: false,
        error: "Invalid Janitor AI URL format.",
        code: "INVALID_URL",
      };
    }

    if (parsedUrl.protocol !== "https:") {
      return {
        success: false,
        error: "Janitor AI URLs must use HTTPS.",
        code: "UNSUPPORTED_SCHEME",
      };
    }

    if (parsedUrl.username || parsedUrl.password) {
      return {
        success: false,
        error: "URLs containing embedded credentials are strictly rejected.",
        code: "EMBEDDED_CREDENTIALS",
      };
    }

    if (parsedUrl.hash) {
      return {
        success: false,
        error: "Janitor AI URLs cannot contain fragments.",
        code: "MALFORMED_TARGET",
      };
    }

    if (!JANITOR_HOSTNAMES.has(parsedUrl.hostname.toLowerCase())) {
      return {
        success: false,
        error: `Hostname "${parsedUrl.hostname}" is not a supported Janitor AI host.`,
        code: "UNSUPPORTED_HOST",
      };
    }

    const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
    const section = pathSegments[0]?.toLowerCase();

    if (section === "characters") {
      const externalId = pathSegments.length === 2
        ? normalizeUuidPrefix(pathSegments[1])
        : null;
      if (!externalId) {
        return {
          success: false,
          error: "Janitor AI character URL does not contain a valid UUID.",
          code: "MALFORMED_TARGET",
        };
      }
      return {
        success: true,
        target: {
          platform: "JANITOR_AI",
          type: "CHARACTER",
          externalId,
          canonicalUrl: canonicalJanitorCharacterUrl(externalId),
          rawInput: trimmed,
        },
      };
    }

    if (section === "profiles") {
      const externalId = pathSegments.length === 2
        ? normalizeUuidPrefix(pathSegments[1])
        : null;
      if (!externalId) {
        return {
          success: false,
          error: "Janitor AI profile URL does not contain a valid UUID.",
          code: "MALFORMED_TARGET",
        };
      }
      return {
        success: true,
        target: {
          platform: "JANITOR_AI",
          type: "CREATOR_PROFILE",
          externalId,
          canonicalUrl: `https://janitorai.com/profiles/${externalId}`,
          rawInput: trimmed,
        },
      };
    }

    if (section === "lorebooks") {
      const externalId = pathSegments.length === 2
        ? normalizeUuidPrefix(pathSegments[1])
        : null;
      if (!externalId) {
        return {
          success: false,
          error: "Janitor AI lorebook URL does not contain a valid UUID.",
          code: "MALFORMED_TARGET",
        };
      }
      return {
        success: true,
        target: {
          platform: "JANITOR_AI",
          type: "LOREBOOK",
          externalId,
          canonicalUrl: `https://janitorai.com/lorebooks/${externalId}`,
          rawInput: trimmed,
        },
      };
    }

    return {
      success: false,
      error: `Unsupported Janitor AI URL target type "/${section ?? ""}".`,
      code: "UNKNOWN_TARGET_TYPE",
    };
  }

  async retrieveCharacter(
    target: SourceTarget,
    options?: RetrievalOptions,
  ): Promise<RetrievedCharacterResult> {
    if (target.platform !== "JANITOR_AI" || target.type !== "CHARACTER") {
      return {
        status: "UNSUPPORTED",
        target,
        error: `JanitorSourceAdapter cannot retrieve target of type ${target.type} on platform ${target.platform}.`,
      };
    }

    const endpoint = `${JANITOR_AI_BASE_URL}${JANITOR_CHARACTER_ENDPOINT}/${encodeURIComponent(target.externalId)}`;
    const fetchImpl = options?.fetch ?? globalThis.fetch;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const onCallerAbort = () => {
      controller.abort();
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        clearTimeout(timeoutId);
        return {
          status: "INACCESSIBLE",
          target,
          error: "Janitor AI request was aborted.",
        };
      }
      options.signal.addEventListener("abort", onCallerAbort, { once: true });
    }

    try {
      if (controller.signal.aborted) {
        return {
          status: "INACCESSIBLE",
          target,
          error: "Janitor AI request was aborted.",
        };
      }

      const headers: Record<string, string> = { Accept: JANITOR_ACCEPT };
      if (options?.authorization) {
        headers["Authorization"] = options.authorization;
      }

      if (diagnosticsEnabled()) {
        console.info("Janitor request diagnostic", createJanitorRequestDiagnostic(endpoint, headers));
      }

      const safeResponse = await safeFetchText(endpoint, {
        fetch: (url, requestInit) => fetchImpl(url, { ...requestInit, headers }),
        signal: controller.signal,
        timeoutMs,
        allowedHosts: [...JANITOR_HOSTNAMES],
        expectedMimeTypes: ["application/json"],
        followRedirects: false,
        lookup: options?.lookup,
      });
      const response = safeResponse.response;

      if (diagnosticsEnabled()) {
        console.info("Janitor response diagnostic", createJanitorResponseDiagnostic(response));
      }

      if (response.status === 401 || response.status === 403) {
        if (options?.authorization) {
          return {
            status: "INACCESSIBLE",
            target,
            error:
              "Janitor rejected the connection. Reconnect with a current authorized credential.",
            unauthorizedConnection: true,
          };
        }
        return {
          status: "INACCESSIBLE",
          target,
          error: "Janitor connection required to retrieve this character.",
          connectionRequired: true,
        };
      }

      if (response.status === 404) {
        return {
          status: "NOT_FOUND",
          target,
          error: "Janitor AI character was not found.",
        };
      }

      if (response.status === 429) {
        const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
        return {
          status: "RATE_LIMITED",
          target,
          error: "Janitor AI rate-limited the request.",
          ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
          retryable: true,
        };
      }

      if ([502, 503, 504].includes(response.status)) {
        return {
          status: "INACCESSIBLE",
          target,
          error: "Janitor AI is temporarily unavailable.",
          retryable: true,
        };
      }

      if (response.status !== 200) {
        return {
          status: "INACCESSIBLE",
          target,
          error: `Janitor AI returned an upstream error (${response.status}).`,
        };
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (
        !contentType.includes("application/json") &&
        !contentType.includes("+json")
      ) {
        return {
          status: "MALFORMED",
          target,
          error: "Janitor AI returned a non-JSON response.",
        };
      }

      const readResult = { text: safeResponse.body };

      let parsed: unknown;
      try {
        parsed = JSON.parse(readResult.text);
      } catch {
        return {
          status: "MALFORMED",
          target,
          error: "Janitor AI returned malformed JSON.",
        };
      }

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          status: "MALFORMED",
          target,
          error: "Janitor AI response must be a JSON object.",
        };
      }

      const rawObj = parsed as Record<string, unknown>;
      if (typeof rawObj.id !== "string" || !normalizeStrictUuid(rawObj.id)) {
        return {
          status: "MALFORMED",
          target,
          error: "Janitor AI response is missing a valid character UUID.",
        };
      }

      if (rawObj.id.toLowerCase() !== target.externalId.toLowerCase()) {
        return {
          status: "MALFORMED",
          target,
          error: `Janitor AI response ID "${rawObj.id}" does not match requested target ID "${target.externalId}".`,
        };
      }

      if (typeof rawObj.name !== "string" || rawObj.name.trim().length === 0) {
        return {
          status: "MALFORMED",
          target,
          error: "Janitor AI response is missing a valid character name.",
        };
      }

      try {
        rejectCredentialShapedData(rawObj);
      } catch (credErr) {
        return {
          status: "MALFORMED",
          target,
          error: credErr instanceof Error ? credErr.message : "Credential-shaped data was rejected.",
        };
      }

      let character: ReturnType<typeof normalizeJanitorCharacter>;
      try {
        character = normalizeJanitorCharacter(
          rawObj as unknown as JanitorCharacterResponse,
          target.canonicalUrl,
        );
      } catch (normErr) {
        return {
          status: "MALFORMED",
          target,
          error: normErr instanceof Error ? normErr.message : "Failed to normalize Janitor character.",
        };
      }

      return {
        status: "RETRIEVED",
        target,
        character,
      };
    } catch (caught) {
      if (caught instanceof SafeFetchError) {
        return {
          status: caught.code === "UNEXPECTED_MIME" || caught.code === "RESPONSE_TOO_LARGE" ? "MALFORMED" : "INACCESSIBLE",
          target,
          error: caught.message,
          retryable: false,
        };
      }
      if (timedOut) {
        return {
          status: "INACCESSIBLE",
          target,
          error: "Janitor AI request timed out.",
          retryable: true,
          timedOut: true,
        };
      }
      if (options?.signal?.aborted) {
        return {
          status: "INACCESSIBLE",
          target,
          error: "Janitor AI request was aborted.",
        };
      }
      return {
        status: "INACCESSIBLE",
        target,
        error: "Janitor AI request failed.",
        retryable: isRetryableNetworkError(caught),
      };
    } finally {
      clearTimeout(timeoutId);
      if (options?.signal) {
        options.signal.removeEventListener("abort", onCallerAbort);
      }
    }
  }

  async retrieveProfilePage(
    target: SourceTarget,
    page: number,
    pageSize: number,
    options?: RetrievalOptions,
  ): Promise<BatchProfilePage> {
    void options;
    return {
      page,
      pageSize,
      hasMore: false,
      items: [],
      error:
        "Janitor AI profile streaming retrieval is not enabled yet in this framework step.",
    };
  }

  async retrieveLorebook(
    target: SourceTarget,
    options?: RetrievalOptions,
  ): Promise<RetrievedLorebookResult> {
    void options;
    return {
      status: "UNSUPPORTED",
      target,
      error: "Janitor AI lorebook live retrieval is not enabled yet in this framework step.",
    };
  }
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  return ["ECONNRESET", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET"].includes(code)
    || /connection reset|timed out|socket hang up/i.test(error.message);
}
