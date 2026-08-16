import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { OwnerAuthConfig } from "./config";
import {
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_TTL_SECONDS,
  signOwnerSessionToken,
  verifyOwnerSessionToken,
} from "./session-token";

export interface OwnerSessionStore {
  create(id: string, expiresAt: Date): Promise<void>;
  delete(id: string): Promise<void>;
  deleteExpired(now: Date): Promise<void>;
  find(id: string): Promise<{ id: string; expiresAt: Date } | null>;
}

export interface IssuedOwnerSession {
  token: string;
  expiresAt: Date;
}

export async function issueOwnerSession(
  config: OwnerAuthConfig,
  options: { now?: Date; store?: OwnerSessionStore; sessionId?: string } = {},
): Promise<IssuedOwnerSession> {
  const now = options.now ?? new Date();
  const store = options.store ?? await defaultOwnerSessionStore();
  const sessionId = options.sessionId ?? randomUUID();
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + OWNER_SESSION_TTL_SECONDS) * 1000);

  await store.deleteExpired(now);
  await store.create(sessionId, expiresAt);
  const token = await signOwnerSessionToken({
    sessionId,
    subject: "owner",
    issuedAt,
    expiresAt: Math.floor(expiresAt.getTime() / 1000),
  }, config.sessionSecret);
  return { token, expiresAt };
}

export async function authenticateOwnerSession(
  token: string | undefined,
  sessionSecret: string,
  options: { now?: Date; store?: OwnerSessionStore } = {},
): Promise<boolean> {
  const now = options.now ?? new Date();
  const payload = await verifyOwnerSessionToken(token, sessionSecret, now);
  if (!payload) return false;
  const store = options.store ?? await defaultOwnerSessionStore();
  const stored = await store.find(payload.sessionId);
  return Boolean(
    stored &&
    stored.expiresAt.getTime() > now.getTime() &&
    Math.floor(stored.expiresAt.getTime() / 1000) === payload.expiresAt,
  );
}

export async function invalidateOwnerSession(
  token: string | undefined,
  sessionSecret: string,
  options: { now?: Date; store?: OwnerSessionStore } = {},
): Promise<void> {
  const payload = await verifyOwnerSessionToken(token, sessionSecret, options.now ?? new Date());
  if (!payload) return;
  const store = options.store ?? await defaultOwnerSessionStore();
  await store.delete(payload.sessionId);
}

export async function requireOwnerPageSession(): Promise<void> {
  const { getOwnerAuthConfig } = await import("./config");
  let authenticated = false;
  try {
    const config = getOwnerAuthConfig();
    const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
    authenticated = await authenticateOwnerSession(token, config.sessionSecret);
  } catch {
    authenticated = false;
  }
  if (!authenticated) redirect("/login");
}

export async function getCurrentOwnerSession(): Promise<boolean> {
  try {
    const { getOwnerAuthConfig } = await import("./config");
    const config = getOwnerAuthConfig();
    const token = (await cookies()).get(OWNER_SESSION_COOKIE)?.value;
    return await authenticateOwnerSession(token, config.sessionSecret);
  } catch {
    return false;
  }
}

export async function requireOwnerApiSession(request: Request): Promise<Response | null> {
  if (!isSameOriginWhenPresent(request)) {
    return Response.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  try {
    const { getOwnerAuthConfig } = await import("./config");
    const config = getOwnerAuthConfig();
    const token = readRequestCookie(request, OWNER_SESSION_COOKIE);
    if (await authenticateOwnerSession(token, config.sessionSecret)) return null;
  } catch {
    // Authentication failures intentionally share one response.
  }
  return Response.json({ error: "Authentication required." }, { status: 401 });
}

export function ownerSessionCookieOptions(expiresAt: Date) {
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

function isSameOriginWhenPresent(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function defaultOwnerSessionStore(): Promise<OwnerSessionStore> {
  const { prisma } = await import("../../../lib/prisma");
  return {
    async create(id, expiresAt) {
      await prisma.ownerSession.create({ data: { id, expiresAt } });
    },
    async delete(id) {
      await prisma.ownerSession.deleteMany({ where: { id } });
    },
    async deleteExpired(now) {
      await prisma.ownerSession.deleteMany({ where: { expiresAt: { lte: now } } });
    },
    async find(id) {
      return prisma.ownerSession.findUnique({
        where: { id },
        select: { id: true, expiresAt: true },
      });
    },
  };
}
