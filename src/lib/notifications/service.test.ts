import { describe, expect, it, vi } from "vitest";
import { NotificationCategory } from "../../../generated/prisma/client";
import {
  cleanupNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_CLEANUP_BATCH,
  NOTIFICATION_READ_RETENTION_MS,
  requireSafeApplicationHref,
  visibleNotificationCategories,
} from "./service";

const NOW = new Date("2026-09-05T12:00:00.000Z");

describe("notification persistence", () => {
  it("keeps MEMBER feeds owned, non-expired, and free of ADMIN categories", async () => {
    const database = memoryDatabase([
      row("member-import", "member", "IMPORT_READY"),
      row("other-import", "other", "IMPORT_READY"),
      row("member-admin", "member", "SYSTEM_WARNING"),
      row("member-expired", "member", "IMPORT_SAVED", { expiresAt: new Date(NOW.getTime() - 1) }),
    ]);
    const feed = await listNotifications("member", "MEMBER", { client: database.client, now: NOW, cleanup: false });
    expect(feed.items.map(({ id }) => id)).toEqual(["member-import"]);
    expect(feed.unreadCount).toBe(1);
    expect(visibleNotificationCategories("MEMBER")).not.toContain(NotificationCategory.SYSTEM_WARNING);
    expect(visibleNotificationCategories("ADMIN")).toContain(NotificationCategory.MODERATION_REVIEW_REQUIRED);
  });

  it("marks one owned item or every eligible owned item read", async () => {
    const database = memoryDatabase([row("one", "member", "IMPORT_READY"), row("two", "member", "IMPORT_SAVED"), row("other", "other", "IMPORT_READY")]);
    await expect(markNotificationRead("member", "MEMBER", "other", { client: database.client, now: NOW })).resolves.toBe(false);
    await expect(markNotificationRead("member", "MEMBER", "one", { client: database.client, now: NOW })).resolves.toBe(true);
    await expect(markAllNotificationsRead("member", "MEMBER", { client: database.client, now: NOW })).resolves.toBe(1);
    expect(database.rows.filter((item) => item.recipientUserId === "member").every((item) => item.readAt?.getTime() === NOW.getTime())).toBe(true);
    expect(database.rows.find((item) => item.id === "other")?.readAt).toBeNull();
  });

  it("deduplicates retried logical transitions", async () => {
    const database = memoryDatabase();
    const input = { recipientUserId: "member", category: NotificationCategory.IMPORT_READY, title: "Ready", dedupeKey: "import-ready:job-1", createdAt: NOW };
    await createNotification(input, database.client);
    await createNotification(input, database.client);
    expect(database.rows).toHaveLength(1);
    expect(database.upsert).toHaveBeenCalledTimes(2);
  });

  it("uses exact retention boundaries and bounds cleanup work", async () => {
    const readCutoff = new Date(NOW.getTime() - NOTIFICATION_READ_RETENTION_MS);
    const rows = Array.from({ length: NOTIFICATION_CLEANUP_BATCH + 5 }, (_, index) => row(`old-${index}`, "member", "IMPORT_READY", { readAt: readCutoff, createdAt: new Date(0) }));
    rows.push(row("keep", "member", "IMPORT_READY", { readAt: new Date(readCutoff.getTime() + 1) }));
    const database = memoryDatabase(rows);
    await expect(cleanupNotifications(database.client, NOW)).resolves.toBe(NOTIFICATION_CLEANUP_BATCH);
    expect(database.rows.some(({ id }) => id === "keep")).toBe(true);
    expect(database.rows.filter(({ id }) => id.startsWith("old-")).length).toBe(5);
  });

  it("rejects external, protocol-relative, backslash, and control-character hrefs", () => {
    expect(requireSafeApplicationHref("/characters/abc?from=notifications#top")).toBe("/characters/abc?from=notifications#top");
    for (const href of ["https://evil.example", "//evil.example", "/\\evil.example", "/characters\nX-Test: bad"]) {
      expect(() => requireSafeApplicationHref(href)).toThrow(/safe application path/);
    }
  });
});

type Row = ReturnType<typeof row>;
type Where = {
  id?: string | { in: string[] };
  recipientUserId?: string;
  category?: { in: NotificationCategory[] };
  createdAt?: { lt?: Date; equals?: Date };
  expiresAt?: { gt?: Date; lte?: Date };
  readAt?: null | { not?: null; lte?: Date };
  OR?: Where[];
};
type Selection = Partial<Record<keyof Row, boolean>>;
function row(id: string, recipientUserId: string, category: keyof typeof NotificationCategory, patch: Partial<{
  createdAt: Date; readAt: Date | null; expiresAt: Date;
}> = {}) {
  return { id, recipientUserId, category: NotificationCategory[category], title: `<b>${id}</b>`, body: `<script>${id}</script>`, href: "/import", entityType: null, entityId: null, dedupeKey: id, createdAt: patch.createdAt ?? NOW, readAt: patch.readAt ?? null, expiresAt: patch.expiresAt ?? new Date(NOW.getTime() + 86_400_000) };
}

function memoryDatabase(initial: Row[] = []) {
  const rows = [...initial];
  const upsert = vi.fn(async ({ where, create }: { where: { dedupeKey: string }; create: Row }) => {
    const existing = rows.find((item) => item.dedupeKey === where.dedupeKey);
    if (existing) return existing;
    const created = { ...create, id: `created-${rows.length + 1}` } as Row; rows.push(created); return created;
  });
  const client = {
    notification: {
      upsert,
      findMany: vi.fn(async (args: { where: Where; take?: number; select?: Selection }) => {
        const found = rows.filter((item) => matches(item, args.where));
        found.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
        return found.slice(0, args.take ?? found.length).map((item) => args.select ? select(item, args.select) : item);
      }),
      count: vi.fn(async ({ where }: { where: Where }) => rows.filter((item) => matches(item, where)).length),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: { readAt: Date } }) => { const found = rows.filter((item) => matches(item, where)); found.forEach((item) => Object.assign(item, data)); return { count: found.length }; }),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => { const ids = new Set(where.id.in); const before = rows.length; for (let i = rows.length - 1; i >= 0; i--) if (ids.has(rows[i]!.id)) rows.splice(i, 1); return { count: before - rows.length }; }),
    },
  };
  return { client: client as never, rows, upsert };
}

function matches(item: Row, where: Where): boolean {
  if (typeof where.id === "object" && !where.id.in.includes(item.id)) return false;
  if (typeof where.id === "string" && item.id !== where.id) return false;
  if (where.recipientUserId && item.recipientUserId !== where.recipientUserId) return false;
  if (where.category?.in && !where.category.in.includes(item.category)) return false;
  if (where.expiresAt?.gt && !(item.expiresAt > where.expiresAt.gt)) return false;
  if (where.readAt === null && item.readAt !== null) return false;
  if (where.createdAt?.lt && !(item.createdAt < where.createdAt.lt)) return false;
  if (where.createdAt?.equals && item.createdAt.getTime() !== where.createdAt.equals.getTime()) return false;
  if (where.OR && !where.OR.some((condition) => matches(item, condition))) return false;
  if (where.expiresAt?.lte && !(item.expiresAt <= where.expiresAt.lte)) return false;
  if (where.readAt?.not === null && item.readAt === null) return false;
  if (where.readAt?.lte && !(item.readAt && item.readAt <= where.readAt.lte)) return false;
  return true;
}
function select(item: Row, fields: Selection) { return Object.fromEntries(Object.keys(fields).filter((key) => fields[key as keyof Row]).map((key) => [key, item[key as keyof Row]])); }
