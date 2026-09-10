import { NotificationCategory, type Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type { UserRole } from "@/src/lib/auth";

export const NOTIFICATION_PAGE_DEFAULT = 20;
export const NOTIFICATION_PAGE_MAX = 50;
export const NOTIFICATION_CLEANUP_BATCH = 100;
export const NOTIFICATION_UNREAD_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const NOTIFICATION_READ_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export type NotificationDto = {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationFeed = {
  items: NotificationDto[];
  unreadCount: number;
  nextCursor: string | null;
  generatedAt: string;
};

type NotificationClient = PrismaClient | Prisma.TransactionClient;

const MEMBER_CATEGORIES: NotificationCategory[] = [
  NotificationCategory.IMPORT_READY,
  NotificationCategory.IMPORT_SAVED,
  NotificationCategory.IMPORT_FAILED,
  NotificationCategory.IMPORT_EXPIRED,
];

export function visibleNotificationCategories(role: UserRole): NotificationCategory[] {
  return role === "ADMIN" ? Object.values(NotificationCategory) : MEMBER_CATEGORIES;
}

export async function listNotifications(
  recipientUserId: string,
  role: UserRole,
  options: { client?: NotificationClient; now?: Date; cursor?: string; limit?: number; cleanup?: boolean } = {},
): Promise<NotificationFeed> {
  const client = options.client ?? (await import("@/lib/prisma")).prisma;
  const now = options.now ?? new Date();
  if (options.cleanup !== false) await cleanupNotifications(client, now);
  const limit = Math.max(1, Math.min(NOTIFICATION_PAGE_MAX, Math.trunc(options.limit ?? NOTIFICATION_PAGE_DEFAULT)));
  const where = eligibleWhere(recipientUserId, role, now);
  const rows = await client.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: parseCursor(options.cursor) }, skip: 1 } : {}),
    select: notificationSelect,
  });
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const unreadCount = await client.notification.count({ where: { ...where, readAt: null } });
  return {
    items: page.map(toDto),
    unreadCount,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]!.id) : null,
    generatedAt: now.toISOString(),
  };
}

export async function markNotificationRead(
  recipientUserId: string,
  role: UserRole,
  notificationId: string,
  options: { client?: NotificationClient; now?: Date } = {},
): Promise<boolean> {
  const client = options.client ?? (await import("@/lib/prisma")).prisma;
  const now = options.now ?? new Date();
  const result = await client.notification.updateMany({
    where: { ...eligibleWhere(recipientUserId, role, now), id: notificationId, readAt: null },
    data: { readAt: now },
  });
  return result.count === 1;
}

export async function markAllNotificationsRead(
  recipientUserId: string,
  role: UserRole,
  options: { client?: NotificationClient; now?: Date } = {},
): Promise<number> {
  const client = options.client ?? (await import("@/lib/prisma")).prisma;
  const now = options.now ?? new Date();
  const result = await client.notification.updateMany({
    where: { ...eligibleWhere(recipientUserId, role, now), readAt: null },
    data: { readAt: now },
  });
  return result.count;
}

export async function createNotification(
  input: {
    recipientUserId: string;
    category: NotificationCategory;
    title: string;
    body?: string | null;
    href?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    dedupeKey: string;
    createdAt?: Date;
  },
  client?: NotificationClient,
): Promise<void> {
  const database = client ?? (await import("@/lib/prisma")).prisma;
  const createdAt = input.createdAt ?? new Date();
  const href = input.href == null ? null : requireSafeApplicationHref(input.href);
  await database.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    update: {},
    create: {
      recipientUserId: input.recipientUserId,
      category: input.category,
      title: boundedText(input.title, 160, "title"),
      body: input.body == null ? null : boundedText(input.body, 800, "body"),
      href,
      entityType: input.entityType == null ? null : boundedText(input.entityType, 64, "entityType"),
      entityId: input.entityId == null ? null : boundedText(input.entityId, 128, "entityId"),
      dedupeKey: boundedText(input.dedupeKey, 191, "dedupeKey"),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + NOTIFICATION_UNREAD_RETENTION_MS),
    },
  });
}

export async function createNotificationForSession(
  userSessionId: string,
  input: Omit<Parameters<typeof createNotification>[0], "recipientUserId">,
  client: NotificationClient,
): Promise<void> {
  const session = await client.userSession.findUnique({ where: { id: userSessionId }, select: { userId: true } });
  if (session) await createNotification({ ...input, recipientUserId: session.userId }, client);
}

export async function createAdminNotifications(
  input: Omit<Parameters<typeof createNotification>[0], "recipientUserId" | "dedupeKey"> & { dedupeKey: string },
  client: NotificationClient,
): Promise<void> {
  const admins = await client.user.findMany({ where: { role: "ADMIN", accessStatus: "ACTIVE" }, select: { id: true } });
  for (const admin of admins) {
    await createNotification({ ...input, recipientUserId: admin.id, dedupeKey: `${input.dedupeKey}:${admin.id}` }, client);
  }
}

export async function cleanupNotifications(client: NotificationClient, now = new Date()): Promise<number> {
  const readCutoff = new Date(now.getTime() - NOTIFICATION_READ_RETENTION_MS);
  const candidates = await client.notification.findMany({
    where: { OR: [{ expiresAt: { lte: now } }, { readAt: { not: null, lte: readCutoff } }] },
    orderBy: { createdAt: "asc" },
    take: NOTIFICATION_CLEANUP_BATCH,
    select: { id: true },
  });
  if (candidates.length === 0) return 0;
  const deleted = await client.notification.deleteMany({ where: { id: { in: candidates.map(({ id }) => id) } } });
  return deleted.count;
}

export function requireSafeApplicationHref(href: string): string {
  if (!href.startsWith("/") || href.startsWith("//") || href.includes("\\") || /[\u0000-\u001f\u007f]/u.test(href) || href.length > 512) {
    throw new Error("Notification href must be a safe application path.");
  }
  const parsed = new URL(href, "https://character-archive.invalid");
  if (parsed.origin !== "https://character-archive.invalid" || !parsed.pathname.startsWith("/")) {
    throw new Error("Notification href must be a safe application path.");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function eligibleWhere(recipientUserId: string, role: UserRole, now: Date): Prisma.NotificationWhereInput {
  return { recipientUserId, expiresAt: { gt: now }, category: { in: visibleNotificationCategories(role) } };
}

function boundedText(value: string, maximum: number, field: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`Invalid notification ${field}.`);
  }
  return normalized;
}

function encodeCursor(id: string): string { return Buffer.from(id, "utf8").toString("base64url"); }
function parseCursor(value: string): string {
  if (!/^[A-Za-z0-9_-]{1,256}$/u.test(value)) throw new Error("Invalid notification cursor.");
  const id = Buffer.from(value, "base64url").toString("utf8");
  if (!id || id.length > 128 || /[^A-Za-z0-9_-]/u.test(id)) throw new Error("Invalid notification cursor.");
  return id;
}

const notificationSelect = {
  id: true, category: true, title: true, body: true, href: true,
  entityType: true, entityId: true, createdAt: true, readAt: true,
} as const;

function toDto(row: Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>): NotificationDto {
  return { ...row, createdAt: row.createdAt.toISOString(), readAt: row.readAt?.toISOString() ?? null };
}
