import { NextResponse } from "next/server";
import {
  getOwnerAuthConfig,
  invalidateOwnerSession,
  OWNER_SESSION_COOKIE,
  readRequestCookie,
} from "@/src/lib/auth";

export async function POST(request: Request): Promise<Response> {
  try {
    const config = getOwnerAuthConfig();
    await invalidateOwnerSession(readRequestCookie(request, OWNER_SESSION_COOKIE), config.sessionSecret);
  } catch {
    return NextResponse.json({ error: "Unable to log out." }, { status: 500 });
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set(OWNER_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
