import { isProtectedPagePath, safePostLoginRedirect } from "./redirects";
import { verifyOwnerSessionToken } from "./session-token";

export type RouteAccessDecision =
  | { action: "allow" }
  | { action: "redirect"; location: string }
  | { action: "unauthorized" };

export async function decideRouteAccess(
  pathname: string,
  token: string | undefined,
  sessionSecret: string | undefined,
  now: Date = new Date(),
): Promise<RouteAccessDecision> {
  if (pathname === "/api/auth/login" || pathname === "/api/auth/logout") return { action: "allow" };
  const isPrivateApi = pathname === "/api" || pathname.startsWith("/api/");
  const isPrivatePage = isProtectedPagePath(pathname);
  if (!isPrivateApi && !isPrivatePage) return { action: "allow" };

  const session = await verifyOwnerSessionToken(token, sessionSecret, now);
  if (session) return { action: "allow" };
  if (isPrivateApi) return { action: "unauthorized" };
  const requestedPath = pathname === "/" ? "/characters" : safePostLoginRedirect(pathname);
  return { action: "redirect", location: `/login?next=${encodeURIComponent(requestedPath)}` };
}
