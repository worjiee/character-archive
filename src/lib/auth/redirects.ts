const PUBLIC_PAGE_PATHS = new Set(["/login", "/bridge/receiver"]);

export function safePostLoginRedirect(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) {
    return "/characters";
  }
  const pathname = value.split(/[?#]/u, 1)[0];
  if (!pathname.startsWith("/api") && !PUBLIC_PAGE_PATHS.has(pathname)) {
    return value;
  }
  return "/characters";
}

export function isProtectedPagePath(pathname: string): boolean {
  return !PUBLIC_PAGE_PATHS.has(pathname);
}
