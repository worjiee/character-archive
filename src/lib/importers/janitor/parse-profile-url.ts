import { JANITOR_HOSTNAMES } from "./parse-url";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseJanitorProfileUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || !JANITOR_HOSTNAMES.has(url.hostname.toLowerCase()) || url.username || url.password || url.hash) {
    throw new Error("Invalid Janitor profile URL.");
  }
  const match = /^\/profiles\/([0-9a-fA-F-]{36})(?:_profile-of-[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/u.exec(url.pathname);
  if (!match || !UUID.test(match[1])) throw new Error("Invalid Janitor profile URL.");
  return match[1].toLowerCase();
}

export function canonicalJanitorProfileUrl(profileId: string): string {
  if (!UUID.test(profileId)) throw new Error("Invalid Janitor profile ID.");
  return `https://janitorai.com/profiles/${profileId.toLowerCase()}`;
}
