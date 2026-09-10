import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  applyAllNotificationsRead,
  applyNotificationRead,
  notificationBadgeText,
  NotificationsPanel,
} from "./notifications-provider";
import type { NotificationFeed } from "@/src/lib/notifications";

const generatedAt = "2026-09-05T12:00:00.000Z";

describe("notifications UI", () => {
  it("renders the desktop popover and mobile drawer from the same safely escaped feed", () => {
    const notifications = context(feed(1));
    const desktop = renderToStaticMarkup(<NotificationsPanel mobile={false} notifications={notifications} onActivate={vi.fn()} />);
    const mobile = renderToStaticMarkup(<NotificationsPanel mobile notifications={notifications} onActivate={vi.fn()} />);
    expect(desktop).toContain("notifications-panel-desktop");
    expect(mobile).toContain("notifications-panel-mobile");
    expect(desktop).toContain("&lt;unsafe-title&gt;");
    expect(desktop).toContain("&lt;script&gt;unsafe-body&lt;/script&gt;");
    expect(desktop).not.toContain("<script>");
    expect(desktop).toContain("Mark all as read");
  });

  it("renders the useful empty state", () => {
    const html = renderToStaticMarkup(<NotificationsPanel mobile={false} notifications={context(feed(0))} onActivate={vi.fn()} />);
    expect(html).toContain("No notifications");
    expect(html).toContain("Import updates and alerts will appear here.");
  });

  it("formats 1, 9, and 10+ badge states", () => {
    expect(notificationBadgeText(1)).toBe("1");
    expect(notificationBadgeText(9)).toBe("9");
    expect(notificationBadgeText(10)).toBe("9+");
  });

  it("updates the shared feed immediately for one or all reads", () => {
    const initial = feed(2);
    const one = applyNotificationRead(initial, "notification-1", generatedAt);
    expect(one.unreadCount).toBe(1);
    expect(one.items[0]?.readAt).toBe(generatedAt);
    const all = applyAllNotificationsRead(one, generatedAt);
    expect(all.unreadCount).toBe(0);
    expect(all.items.every((item) => item.readAt === generatedAt)).toBe(true);
  });
});

function feed(unreadCount: number): NotificationFeed {
  return {
    unreadCount,
    nextCursor: null,
    generatedAt,
    items: Array.from({ length: unreadCount }, (_, index) => ({
      id: `notification-${index + 1}`,
      category: "IMPORT_READY",
      title: "<unsafe-title>",
      body: "<script>unsafe-body</script>",
      href: "/import",
      entityType: "ImportPreviewJob",
      entityId: `job-${index + 1}`,
      createdAt: generatedAt,
      readAt: null,
    })),
  };
}

function context(value: NotificationFeed) {
  return { ...value, refresh: vi.fn(async () => undefined), markAllRead: vi.fn(async () => undefined), markRead: vi.fn(async () => undefined) };
}
