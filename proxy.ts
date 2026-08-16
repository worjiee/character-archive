import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { decideRouteAccess, OWNER_SESSION_COOKIE } from "@/src/lib/auth";

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const decision = await decideRouteAccess(
    request.nextUrl.pathname,
    request.cookies.get(OWNER_SESSION_COOKIE)?.value,
    process.env.AUTH_SESSION_SECRET,
  );

  if (decision.action === "unauthorized") {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (decision.action === "redirect") {
    return NextResponse.redirect(new URL(decision.location, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/characters/:path*", "/import/:path*", "/blocked/:path*", "/settings/:path*", "/api/:path*"],
};
