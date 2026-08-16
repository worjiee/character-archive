const PROTECTED_PAGE_PREFIXES = ["/characters", "/import", "/blocked", "/settings"];

export function safePostLoginRedirect(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//")) {
    return "/characters";
  }
  const pathname = value.split(/[?#]/u, 1)[0];
  if (pathname === "/" || PROTECTED_PAGE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return value;
  }
  return "/characters";
}

export function isProtectedPagePath(pathname: string): boolean {
  return pathname === "/" || PROTECTED_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
