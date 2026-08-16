export const OWNER_SESSION_COOKIE = "character_archive_session";
export const OWNER_SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface OwnerSessionPayload {
  sessionId: string;
  subject: "owner";
  issuedAt: number;
  expiresAt: number;
}

export async function signOwnerSessionToken(
  payload: OwnerSessionPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = await hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyOwnerSessionToken(
  token: string | undefined,
  secret: string | undefined,
  now: Date = new Date(),
): Promise<OwnerSessionPayload | null> {
  if (!token || !secret || new TextEncoder().encode(secret).byteLength < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expectedSignature = await hmac(parts[0], secret);
  if (!constantTimeStringEqual(parts[1], expectedSignature)) return null;

  try {
    const value: unknown = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (!isSessionPayload(value)) return null;
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (value.issuedAt > nowSeconds + 60 || value.expiresAt <= nowSeconds) return null;
    if (value.expiresAt - value.issuedAt > OWNER_SESSION_TTL_SECONDS) return null;
    return value;
  } catch {
    return null;
  }
}

function isSessionPayload(value: unknown): value is OwnerSessionPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.subject === "owner" &&
    typeof payload.sessionId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(payload.sessionId) &&
    Number.isInteger(payload.issuedAt) &&
    Number.isInteger(payload.expiresAt) &&
    Number(payload.expiresAt) > Number(payload.issuedAt);
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Buffer.from(signature).toString("base64url");
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}
