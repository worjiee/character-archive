"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationDto, NotificationFeed } from "@/src/lib/notifications";

type NotificationsContextValue = NotificationFeed & {
  refresh: () => Promise<void>;
  markAllRead: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ initialFeed, children }: { initialFeed: NotificationFeed; children?: React.ReactNode }) {
  const [feed, setFeed] = useState(initialFeed);
  const requestRef = useRef<Promise<void> | null>(null);
  const pathname = usePathname();

  const refresh = useCallback(async () => {
    if (requestRef.current) return requestRef.current;
    const request = (async () => {
      try {
        const response = await fetch("/api/notifications", { credentials: "same-origin", cache: "no-store" });
        if (response.ok) setFeed(await response.json() as NotificationFeed);
      } finally { requestRef.current = null; }
    })();
    requestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  useEffect(() => { void refresh(); }, [pathname, refresh]);

  const markRead = useCallback(async (id: string) => {
    const target = feed.items.find((item) => item.id === id);
    if (!target || target.readAt) return;
    const readAt = new Date().toISOString();
    setFeed((current) => applyNotificationRead(current, id, readAt));
    const response = await fetch("/api/notifications", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) await refresh();
  }, [feed.items, refresh]);

  const markAllRead = useCallback(async () => {
    if (feed.unreadCount === 0) return;
    const readAt = new Date().toISOString();
    setFeed((current) => applyAllNotificationsRead(current, readAt));
    const response = await fetch("/api/notifications", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    if (!response.ok) await refresh();
  }, [feed.unreadCount, refresh]);

  const value = useMemo(() => ({ ...feed, refresh, markAllRead, markRead }), [feed, markAllRead, markRead, refresh]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function NotificationsBell({ mobile = false }: { mobile?: boolean }) {
  const notifications = useNotifications();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  async function openPanel() {
    const next = !open;
    setOpen(next);
    if (next) await notifications.refresh();
  }

  async function activate(item: NotificationDto, event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    await notifications.markRead(item.id);
    setOpen(false);
    if (item.href) router.push(item.href);
  }

  return (
    <div ref={rootRef} className={`notifications-root ${mobile ? "notifications-root-mobile" : "notifications-root-desktop"}`}>
      <button ref={buttonRef} type="button" onClick={() => void openPanel()} aria-label="Notifications" aria-expanded={open} aria-controls={`notifications-panel-${mobile ? "mobile" : "desktop"}`} className="header-utility-control notifications-trigger archive-focus">
        <BellIcon />
        {notifications.unreadCount > 0 && <span className="notifications-badge" aria-label={`${notifications.unreadCount} unread notifications`}>{notificationBadgeText(notifications.unreadCount)}</span>}
      </button>
      {open && <NotificationsPanel mobile={mobile} notifications={notifications} onActivate={(item, event) => void activate(item, event)} />}
    </div>
  );
}

export function NotificationsPanel({ mobile, notifications, onActivate }: {
  mobile: boolean;
  notifications: NotificationsContextValue;
  onActivate: (item: NotificationDto, event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <section id={`notifications-panel-${mobile ? "mobile" : "desktop"}`} role="dialog" aria-label="Notifications" className={`notifications-panel ${mobile ? "notifications-panel-mobile" : "notifications-panel-desktop"}`}>
          <div className="notifications-panel-header">
            <div><p>Notifications</p><span>{notifications.unreadCount > 0 ? `${notifications.unreadCount} unread` : "Up to date"}</span></div>
            {notifications.unreadCount > 0 && <button type="button" onClick={() => void notifications.markAllRead()} className="archive-focus">Mark all as read</button>}
          </div>
          <div className="notifications-list">
            {notifications.items.length === 0 ? <div className="notifications-empty"><BellIcon /><strong>No notifications</strong><span>Import updates and alerts will appear here.</span></div> : notifications.items.map((item) => (
              item.href ? (
                <Link key={item.id} href={item.href} onClick={(event) => onActivate(item, event)} className="notification-item archive-focus" data-unread={!item.readAt || undefined}>
                  <NotificationContent item={item} generatedAt={notifications.generatedAt} />
                </Link>
              ) : (
                <button key={item.id} type="button" onClick={() => void notifications.markRead(item.id)} className="notification-item archive-focus" data-unread={!item.readAt || undefined}>
                  <NotificationContent item={item} generatedAt={notifications.generatedAt} />
                </button>
              )
            ))}
          </div>
    </section>
  );
}

function NotificationContent({ item, generatedAt }: { item: NotificationDto; generatedAt: string }) {
  return <><span className="notification-category-icon" aria-hidden="true">{categoryIcon(item.category)}</span><span className="notification-copy"><strong>{item.title}</strong>{item.body && <span>{item.body}</span>}<time dateTime={item.createdAt}>{relativeTime(item.createdAt, generatedAt)}</time></span>{!item.readAt && <span className="notification-unread-dot" aria-hidden="true" />}</>;
}

export function notificationBadgeText(count: number): string { return count > 9 ? "9+" : String(count); }

export function applyNotificationRead(feed: NotificationFeed, id: string, readAt: string): NotificationFeed {
  const target = feed.items.find((item) => item.id === id);
  if (!target || target.readAt) return feed;
  return { ...feed, unreadCount: Math.max(0, feed.unreadCount - 1), items: feed.items.map((item) => item.id === id ? { ...item, readAt } : item) };
}

export function applyAllNotificationsRead(feed: NotificationFeed, readAt: string): NotificationFeed {
  if (feed.unreadCount === 0) return feed;
  return { ...feed, unreadCount: 0, items: feed.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })) };
}

function useNotifications(): NotificationsContextValue {
  const context = useContext(NotificationsContext);
  if (!context) throw new Error("NotificationsBell must be used within NotificationsProvider.");
  return context;
}

function BellIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>; }
function categoryIcon(category: NotificationDto["category"]): string {
  if (category === "FAVORITE_CREATOR_NEW_CHARACTER") return "♥";
  if (category === "MODERATION_REVIEW_REQUIRED") return "!";
  if (category === "SYSTEM_WARNING" || category === "IMPORT_FAILED") return "×";
  if (category === "IMPORT_SAVED") return "✓";
  if (category === "IMPORT_EXPIRED") return "⌛";
  return "↓";
}
function relativeTime(createdAt: string, generatedAt: string): string {
  const seconds = Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60); if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24); return `${days}d ago`;
}
