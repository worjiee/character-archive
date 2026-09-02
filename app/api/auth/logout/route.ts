import { NextResponse } from "next/server";
import {
  invalidateUserSession,
  isSameOriginWhenPresent,
  LEGACY_OWNER_SESSION_COOKIE,
  readRequestCookie,
  USER_SESSION_COOKIE,
} from "@/src/lib/auth";

export async function POST(request: Request): Promise<Response> {
  if (!isSameOriginWhenPresent(request)) {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  try {
    await invalidateUserSession(readRequestCookie(request, USER_SESSION_COOKIE));
  } catch {
    return NextResponse.json({ error: "Unable to log out." }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(USER_SESSION_COOKIE, "", expiredCookieOptions());
  response.cookies.set(LEGACY_OWNER_SESSION_COOKIE, "", expiredCookieOptions());
  return response;
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
