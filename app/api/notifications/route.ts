import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/src/lib/notifications";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? undefined : Number(rawLimit);
    if (rawLimit != null && (!/^\d+$/u.test(rawLimit) || !Number.isSafeInteger(limit))) throw new Error("Invalid limit.");
    return Response.json(
      await listNotifications(session.principal.userId, session.principal.role, { cursor, limit }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return Response.json({ error: "Invalid notification request." }, { status: 400 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body.");
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "id" && key !== "all")) throw new Error("Invalid body.");
    if (record.all === true && record.id === undefined) {
      const updated = await markAllNotificationsRead(session.principal.userId, session.principal.role);
      return Response.json({ updated });
    }
    if (typeof record.id === "string" && record.id.length > 0 && record.id.length <= 128 && record.all === undefined) {
      const updated = await markNotificationRead(session.principal.userId, session.principal.role, record.id);
      return Response.json({ updated: updated ? 1 : 0 });
    }
    throw new Error("Invalid body.");
  } catch {
    return Response.json({ error: "Invalid notification request." }, { status: 400 });
  }
}
