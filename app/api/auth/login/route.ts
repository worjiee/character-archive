import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  issueUserSession,
  LEGACY_OWNER_SESSION_COOKIE,
  loginRateLimiter,
  loginRateLimitKey,
  normalizeUsername,
  PasswordHashError,
  safePostLoginRedirect,
  USER_SESSION_COOKIE,
  userSessionCookieOptions,
  verifyPassword,
} from "@/src/lib/auth";

const MAX_LOGIN_BODY_BYTES = 16 * 1024;
const DUMMY_PASSWORD_HASH = "scrypt:ln=14,r=8,p=1:L6MKspkj5lG_4L69nDdf3Q:Nz_SNX23nxcQs8xV-gvORJvmVOMqkthDaPzWFOIi9zIgMJ2zoQPGusfRAnpR1R8gsCAZxD3YFim5ENIyF09_5g";

export async function POST(request: Request): Promise<Response> {
  const key = loginRateLimitKey(request);
  const rateLimit = loginRateLimiter.check(key);
  if (rateLimit.limited) {
    return NextResponse.json(
      { error: "Unable to sign in. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_LOGIN_BODY_BYTES) return invalidCredentials(key);
    const body = await readLoginBody(request);
    const normalizedUsername = typeof body.username === "string" && body.username.length <= 320
      ? normalizeUsername(body.username)
      : "";
    const user = normalizedUsername
      ? await prisma.user.findUnique({
        where: { normalizedUsername },
        select: { id: true, passwordHash: true, accessStatus: true },
      })
      : null;
    const passwordMatches = await verifyPassword(body.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !passwordMatches || user.accessStatus !== "ACTIVE") return invalidCredentials(key);

    loginRateLimiter.clear(key);
    const session = await issueUserSession(user.id);
    const redirectTo = safePostLoginRedirect(body.redirectTo);
    const response = NextResponse.json({ success: true, redirectTo });
    response.cookies.set(USER_SESSION_COOKIE, session.token, userSessionCookieOptions(session.expiresAt));
    response.cookies.set(LEGACY_OWNER_SESSION_COOKIE, "", expiredCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof PasswordHashError) {
      return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
    }
    if (error instanceof SyntaxError) return invalidCredentials(key);
    return NextResponse.json({ error: "Unable to sign in." }, { status: 500 });
  }
}

async function readLoginBody(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json();
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function invalidCredentials(key: string): NextResponse {
  loginRateLimiter.recordFailure(key);
  return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
}

function expiredCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 0,
  };
}
