const JANITOR_HOSTNAMES = new Set(["janitorai.com", "www.janitorai.com"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidJanitorCharacterId(characterId: string): boolean {
  return UUID_PATTERN.test(characterId);
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

  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);

  if (pathSegments[0] !== "characters" || !pathSegments[1]) {
    throw new TypeError("Janitor AI character URLs must begin with /characters/.");
  }

  const externalId = pathSegments[1].split("_")[0];

  if (!isValidJanitorCharacterId(externalId)) {
    throw new TypeError("Janitor AI character URL does not contain a valid UUID.");
  }

  return externalId.toLowerCase();
}
