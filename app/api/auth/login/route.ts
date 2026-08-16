import { NextResponse } from "next/server";
import {
  AuthConfigurationError,
  getOwnerAuthConfig,
  issueOwnerSession,
  loginRateLimiter,
  loginRateLimitKey,
  OWNER_SESSION_COOKIE,
  OwnerPasswordHashError,
  ownerSessionCookieOptions,
  safePostLoginRedirect,
  verifyOwnerCredentials,
} from "@/src/lib/auth";

const MAX_LOGIN_BODY_BYTES = 16 * 1024;

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
    const config = getOwnerAuthConfig();
    const valid = await verifyOwnerCredentials(
      body.username,
      body.password,
      config.username,
      config.passwordHash,
    );
    if (!valid) return invalidCredentials(key);

    loginRateLimiter.clear(key);
    const session = await issueOwnerSession(config);
    const redirectTo = safePostLoginRedirect(body.redirectTo);
    const response = NextResponse.json({ success: true, redirectTo });
    response.cookies.set(OWNER_SESSION_COOKIE, session.token, ownerSessionCookieOptions(session.expiresAt));
    return response;
  } catch (error) {
    if (error instanceof AuthConfigurationError || error instanceof OwnerPasswordHashError) {
      return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
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
