import { isProtectedPagePath, safePostLoginRedirect } from "./redirects";
import { isPotentialUserSessionToken } from "./session-token";

export type RouteAccessDecision =
  | { action: "allow" }
  | { action: "redirect"; location: string }
  | { action: "unauthorized" };

export function decideRouteAccess(
  pathname: string,
  token: string | undefined,
): RouteAccessDecision {
  if (
    pathname === "/api/health" ||
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/bridge/pair/exchange" ||
    pathname === "/api/bridge/import" ||
    pathname === "/api/bridge/extension/pair/exchange" ||
    pathname === "/api/bridge/extension/import"
  ) return { action: "allow" };
  const isPrivateApi = pathname === "/api" || pathname.startsWith("/api/");
  const isPrivatePage = isProtectedPagePath(pathname);
  if (!isPrivateApi && !isPrivatePage) return { action: "allow" };

  if (isPotentialUserSessionToken(token)) return { action: "allow" };
  if (isPrivateApi) return { action: "unauthorized" };
  const requestedPath = pathname === "/" ? "/characters" : safePostLoginRedirect(pathname);
  return { action: "redirect", location: `/login?next=${encodeURIComponent(requestedPath)}` };
}
