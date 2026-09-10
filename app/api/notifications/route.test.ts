import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const service = vi.hoisted(() => ({ listNotifications: vi.fn(), markNotificationRead: vi.fn(), markAllNotificationsRead: vi.fn() }));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/notifications", () => service);
import { GET, PATCH } from "./route";

const session = { sessionId: "session", principal: { userId: "member", role: "MEMBER", username: "member", displayName: null } };

describe("/api/notifications", () => {
  beforeEach(() => { vi.clearAllMocks(); auth.requireUserApiSession.mockResolvedValue(null); auth.getAuthenticatedUserApiSession.mockResolvedValue(session); service.listNotifications.mockResolvedValue({ items: [], unreadCount: 0, nextCursor: null, generatedAt: new Date().toISOString() }); });

  it("always scopes reads and mutations to the authenticated user", async () => {
    await GET(new Request("http://localhost/api/notifications?limit=10"));
    expect(service.listNotifications).toHaveBeenCalledWith("member", "MEMBER", { cursor: undefined, limit: 10 });
    service.markNotificationRead.mockResolvedValue(false);
    await PATCH(request({ id: "another-users-notification" }));
    expect(service.markNotificationRead).toHaveBeenCalledWith("member", "MEMBER", "another-users-notification");
    await PATCH(request({ all: true }));
    expect(service.markAllNotificationsRead).toHaveBeenCalledWith("member", "MEMBER");
  });

  it("rejects revoked or invalid sessions before accessing notification data", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    expect((await GET(new Request("http://localhost/api/notifications"))).status).toBe(401);
    expect((await PATCH(request({ all: true }))).status).toBe(401);
    expect(service.listNotifications).not.toHaveBeenCalled();
  });

  it("rejects arbitrary fields and malformed mark-all requests", async () => {
    expect((await PATCH(request({ id: "one", recipientUserId: "other" }))).status).toBe(400);
    expect((await PATCH(request({ all: true, id: "one" }))).status).toBe(400);
  });
});

function request(body: unknown) { return new Request("http://localhost/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
