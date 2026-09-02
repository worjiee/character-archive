import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireAdminApiSession: vi.fn() }));
const users = vi.hoisted(() => ({ createMember: vi.fn(), listManagedUsers: vi.fn() }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/users/access-management", () => users);

import { GET, POST } from "./route";

const USER = {
  id: "member-1",
  username: "friend",
  displayName: "Friend",
  role: "MEMBER",
  accessStatus: "ACTIVE",
  createdAt: new Date("2026-08-28T10:00:00.000Z"),
  updatedAt: new Date("2026-08-28T10:00:00.000Z"),
};

describe("/api/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAdminApiSession.mockResolvedValue(null);
    users.listManagedUsers.mockResolvedValue([USER]);
    users.createMember.mockResolvedValue(USER);
  });

  it("allows an ADMIN to list only managed user data", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      users: [{ ...USER, createdAt: USER.createdAt.toISOString(), updatedAt: USER.updatedAt.toISOString() }],
    });
  });

  it("returns the authoritative 403 and does not list or create for a MEMBER", async () => {
    auth.requireAdminApiSession.mockResolvedValue(Response.json({ error: "Administrator access required." }, { status: 403 }));
    expect((await GET(request())).status).toBe(403);
    expect((await POST(request({ username: "friend" }))).status).toBe(403);
    expect(users.listManagedUsers).not.toHaveBeenCalled();
    expect(users.createMember).not.toHaveBeenCalled();
  });

  it("creates a MEMBER from only the supplied credential fields", async () => {
    const body = {
      username: "friend",
      displayName: "Friend",
      password: "member password phrase",
      confirmPassword: "member password phrase",
    };
    const response = await POST(request(body));
    expect(response.status).toBe(201);
    expect(users.createMember).toHaveBeenCalledWith(body);
    await expect(response.json()).resolves.not.toHaveProperty("user.passwordHash");
  });
});

function request(body?: unknown): Request {
  return new Request("http://localhost:3000/api/admin/users", {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
