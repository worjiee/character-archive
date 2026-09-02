import { createHash, randomBytes } from "node:crypto";

export const USER_SESSION_COOKIE = "character_archive_user_session";
export const LEGACY_OWNER_SESSION_COOKIE = "character_archive_session";
export const USER_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const USER_SESSION_TOKEN_BYTES = 32;

export function createUserSessionToken(): string {
  return randomBytes(USER_SESSION_TOKEN_BYTES).toString("base64url");
}

export function hashUserSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isPotentialUserSessionToken(token: string | undefined): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/u.test(token);
}
