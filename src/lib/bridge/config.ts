import { BridgeError } from "./errors";
import { JANITOR_PAGE_ORIGINS } from "./receiver-channel";

const CHROME_EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/u;

export function configuredArchiveOrigins(
  value = process.env.BRIDGE_ARCHIVE_ORIGINS,
): Set<string> {
  const origins = new Set<string>();
  for (const candidate of value?.split(",") ?? []) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const parsed = new URL(trimmed);
      if (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        parsed.origin === trimmed.replace(/\/$/, "")
      ) {
        origins.add(parsed.origin);
      }
    } catch {
      // Invalid configured entries are ignored; an empty allowlist fails closed.
    }
  }
  return origins;
}

export function requireAllowedArchiveOrigin(
  origin: string,
  allowed = configuredArchiveOrigins(),
): void {
  if (!allowed.has(origin)) {
    throw new BridgeError(
      "ARCHIVE_ORIGIN_NOT_ALLOWED",
      "This Character Archive origin is not configured for browser bridging.",
      403,
    );
  }
}

export function configuredCompanionOrigins(
  value = process.env.BRIDGE_EXTENSION_ORIGINS,
): Set<string> {
  const origins = new Set<string>();
  for (const candidate of value?.split(",") ?? []) {
    const trimmed = candidate.trim();
    if (CHROME_EXTENSION_ORIGIN.test(trimmed)) origins.add(trimmed);
  }
  return origins;
}

export function requireCompanionOrigin(
  request: Request,
  allowed = configuredCompanionOrigins(),
): string {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!CHROME_EXTENSION_ORIGIN.test(origin) || !allowed.has(origin)) {
    throw new BridgeError(
      "COMPANION_ORIGIN_NOT_ALLOWED",
      "This Character Archive Companion is not configured for browser bridging.",
      403,
    );
  }
  return origin;
}

export function requireJanitorPageOrigin(request: Request): string {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!JANITOR_PAGE_ORIGINS.has(origin)) {
    throw new BridgeError(
      "SOURCE_ORIGIN_NOT_ALLOWED",
      "The bridge request did not originate from an approved Janitor page.",
      403,
    );
  }
  return origin;
}

export function requireArchiveReceiverOrigin(
  request: Request,
  allowed = configuredArchiveOrigins(),
): string {
  const archiveOrigin = new URL(request.url).origin;
  requireAllowedArchiveOrigin(archiveOrigin, allowed);
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (origin !== archiveOrigin) {
    throw new BridgeError(
      "RECEIVER_ORIGIN_NOT_ALLOWED",
      "The bridge transport must come from the Character Archive receiver.",
      403,
    );
  }
  return origin;
}

export function bridgeReceiverPreflight(request: Request): Response {
  try {
    requireArchiveReceiverOrigin(request);
    return new Response(null, { status: 204 });
  } catch (error) {
    return error instanceof BridgeError
      ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
      : new Response(null, { status: 403 });
  }
}

export function withBridgeCors(request: Request, response: Response): Response {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!JANITOR_PAGE_ORIGINS.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Archive-Bridge-Token");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function bridgePreflight(request: Request): Response {
  try {
    requireJanitorPageOrigin(request);
    return withBridgeCors(request, new Response(null, { status: 204 }));
  } catch (error) {
    const response = error instanceof BridgeError
      ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
      : new Response(null, { status: 403 });
    return withBridgeCors(request, response);
  }
}

export function withCompanionCors(
  request: Request,
  response: Response,
  allowed = configuredCompanionOrigins(),
): Response {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (!allowed.has(origin) || !CHROME_EXTENSION_ORIGIN.test(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Archive-Bridge-Token");
  headers.set("Vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function companionPreflight(request: Request): Response {
  try {
    requireCompanionOrigin(request);
    return withCompanionCors(request, new Response(null, { status: 204 }));
  } catch (error) {
    const response = error instanceof BridgeError
      ? Response.json({ error: { code: error.code, message: error.message } }, { status: error.status })
      : new Response(null, { status: 403 });
    return withCompanionCors(request, response);
  }
}
