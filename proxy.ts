import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { decideRouteAccess, USER_SESSION_COOKIE } from "./src/lib/auth";

export function proxy(request: NextRequest): NextResponse {
  const decision = decideRouteAccess(
    request.nextUrl.pathname,
    request.cookies.get(USER_SESSION_COOKIE)?.value,
  );

  if (decision.action === "unauthorized") {
    if (request.nextUrl.pathname === "/api/import/preview") {
      return NextResponse.json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Your session has expired. Sign in again and retry.",
        },
      }, { status: 401 });
    }
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)"],
};
