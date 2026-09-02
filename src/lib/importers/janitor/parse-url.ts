import { normalizeStrictUuid, normalizeUuidPrefix } from "../source-identifiers";

export const JANITOR_HOSTNAMES = new Set(["janitorai.com", "www.janitorai.com"]);

export function isValidJanitorCharacterId(characterId: string): boolean {
  return normalizeStrictUuid(characterId) !== null;
}

export function parseJanitorCharacterUrl(url: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    throw new TypeError("Invalid Janitor AI character URL.");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new TypeError("Janitor AI character URLs must use HTTPS.");
  }

  if (!JANITOR_HOSTNAMES.has(parsedUrl.hostname.toLowerCase())) {
    throw new TypeError("URL hostname must be janitorai.com or www.janitorai.com.");
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new TypeError("Janitor AI character URLs cannot contain embedded credentials.");
  }

  if (parsedUrl.hash) {
    throw new TypeError("Janitor AI character URLs cannot contain fragments.");
  }

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

  if (pathSegments.length !== 2 || pathSegments[0] !== "characters" || !pathSegments[1]) {
    throw new TypeError("Janitor AI character URLs must begin with /characters/.");
  }

  const externalId = normalizeUuidPrefix(pathSegments[1]);

  if (!externalId) {
    throw new TypeError("Janitor AI character URL does not contain a valid UUID.");
  }

  return externalId;
}

export function canonicalJanitorCharacterUrl(externalId: string): string {
  const normalized = normalizeStrictUuid(externalId);
  if (!normalized) throw new TypeError("Janitor AI character ID must be a valid UUID.");
  return `https://janitorai.com/characters/${normalized}`;
}
