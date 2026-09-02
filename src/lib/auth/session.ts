import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createUserSessionToken,
  hashUserSessionToken,
  isPotentialUserSessionToken,
  USER_SESSION_COOKIE,
  USER_SESSION_TTL_SECONDS,
} from "./session-token";

export type UserRole = "ADMIN" | "MEMBER";

export interface AuthenticatedPrincipal {
  userId: string;
  username: string;
  displayName: string | null;
  role: UserRole;
}

export interface AuthenticatedUserSession {
  sessionId: string;
  expiresAt: Date;
  principal: AuthenticatedPrincipal;
}

interface StoredUserSession {
  id: string;
  expiresAt: Date;
  user: AuthenticatedPrincipal & { accessStatus: "ACTIVE" | "REVOKED" };
}

export interface UserSessionStore {
  create(tokenHash: string, userId: string, expiresAt: Date): Promise<{ id: string }>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<StoredUserSession | null>;
}

export interface IssuedUserSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

export async function issueUserSession(
  userId: string,
  options: { now?: Date; store?: UserSessionStore; token?: string } = {},
): Promise<IssuedUserSession> {
  const now = options.now ?? new Date();
  const store = options.store ?? await defaultUserSessionStore();
  const token = options.token ?? createUserSessionToken();
  if (!isPotentialUserSessionToken(token)) throw new Error("Unable to issue a valid user session token.");
  const expiresAt = new Date(now.getTime() + USER_SESSION_TTL_SECONDS * 1000);

  await store.deleteExpired(now);
  const session = await store.create(hashUserSessionToken(token), userId, expiresAt);
  return { token, sessionId: session.id, expiresAt };
}

export async function authenticateUserSession(
  token: string | undefined,
  options: { now?: Date; store?: UserSessionStore } = {},
): Promise<AuthenticatedUserSession | null> {
  if (!isPotentialUserSessionToken(token)) return null;
  const now = options.now ?? new Date();
  const store = options.store ?? await defaultUserSessionStore();
  const stored = await store.findByTokenHash(hashUserSessionToken(token));
  if (!stored || stored.expiresAt.getTime() <= now.getTime() || stored.user.accessStatus !== "ACTIVE") {
    return null;
  }
  return {
    sessionId: stored.id,
    expiresAt: stored.expiresAt,
    principal: {
      userId: stored.user.userId,
      username: stored.user.username,
      displayName: stored.user.displayName,
      role: stored.user.role,
    },
  };
}

export async function invalidateUserSession(
  token: string | undefined,
  options: { store?: UserSessionStore } = {},
): Promise<void> {
  if (!isPotentialUserSessionToken(token)) return;
  const store = options.store ?? await defaultUserSessionStore();
  await store.deleteByTokenHash(hashUserSessionToken(token));
}

export async function requireUserPageSession(): Promise<AuthenticatedPrincipal> {
  try {
    const token = (await cookies()).get(USER_SESSION_COOKIE)?.value;
    const session = await authenticateUserSession(token);
    if (session) return session.principal;
  } catch {
    // Database and malformed-session failures intentionally become a login redirect.
  }
  redirect("/login");
}

export async function requireAdminPageSession(): Promise<AuthenticatedPrincipal> {
  const principal = await requireUserPageSession();
  if (principal.role !== "ADMIN") redirect("/characters");
  return principal;
}

export async function getCurrentUserSession(): Promise<AuthenticatedUserSession | null> {
  try {
    const token = (await cookies()).get(USER_SESSION_COOKIE)?.value;
    return await authenticateUserSession(token);
  } catch {
    return null;
  }
}

export async function requireUserApiSession(
  request: Request,
  options: { now?: Date; store?: UserSessionStore } = {},
): Promise<Response | null> {
  if (!isSameOriginWhenPresent(request)) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  return await getAuthenticatedUserApiSession(request, options)
    ? null
    : Response.json({ error: "Authentication required." }, { status: 401 });
}

export async function requireAdminApiSession(
  request: Request,
  options: { now?: Date; store?: UserSessionStore } = {},
): Promise<Response | null> {
  if (!isSameOriginWhenPresent(request)) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }
  const session = await getAuthenticatedUserApiSession(request, options);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (session.principal.role !== "ADMIN") {
    return Response.json({ error: "Administrator access required." }, { status: 403 });
  }
  return null;
}

export async function getAuthenticatedUserApiSession(
  request: Request,
  options: { now?: Date; store?: UserSessionStore } = {},
): Promise<AuthenticatedUserSession | null> {
  if (!isSameOriginWhenPresent(request)) return null;
  try {
    return await authenticateUserSession(readRequestCookie(request, USER_SESSION_COOKIE), options);
  } catch {
    return null;
  }
}

export function userSessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    expires: expiresAt,
    priority: "high" as const,
  };
}

export function readRequestCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isSameOriginWhenPresent(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const expectedHost = request.headers.get("host")?.trim()
      ?? firstForwardedValue(request.headers.get("x-forwarded-host"))
      ?? requestUrl.host;
    const expectedProtocol = firstForwardedValue(request.headers.get("x-forwarded-proto"))
      ?? requestUrl.protocol.slice(0, -1);
    if (expectedProtocol !== "http" && expectedProtocol !== "https") return false;
    return originUrl.host.toLowerCase() === expectedHost.toLowerCase()
      && originUrl.protocol === `${expectedProtocol}:`;
  } catch {
    return false;
  }
}

function firstForwardedValue(value: string | null): string | null {
  const first = value?.split(",", 1)[0]?.trim();
  return first || null;
}

async function defaultUserSessionStore(): Promise<UserSessionStore> {
  const { prisma } = await import("../../../lib/prisma");
  return {
    async create(tokenHash, userId, expiresAt) {
      return prisma.userSession.create({ data: { tokenHash, userId, expiresAt }, select: { id: true } });
    },
    async deleteByTokenHash(tokenHash) {
      await prisma.userSession.deleteMany({ where: { tokenHash } });
    },
    async deleteExpired(now) {
      await prisma.userSession.deleteMany({ where: { expiresAt: { lte: now } } });
    },
    async findByTokenHash(tokenHash) {
      const session = await prisma.userSession.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          expiresAt: true,
          user: {
            select: {
              id: true,
              username: true,
              displayName: true,
              role: true,
              accessStatus: true,
            },
          },
        },
      });
      if (!session) return null;
      return {
        id: session.id,
        expiresAt: session.expiresAt,
        user: {
          userId: session.user.id,
          username: session.user.username,
          displayName: session.user.displayName,
          role: session.user.role,
          accessStatus: session.user.accessStatus,
        },
      };
    },
  };
}
