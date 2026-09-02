import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireAdminApiSession: vi.fn() }));
const users = vi.hoisted(() => ({ reactivateMember: vi.fn(), resetMemberPassword: vi.fn(), revokeMember: vi.fn() }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/users/access-management", () => users);

import { POST as reactivate } from "./[id]/reactivate/route";
import { POST as resetPassword } from "./[id]/reset-password/route";
import { POST as revoke } from "./[id]/revoke/route";

describe("ADMIN MEMBER lifecycle routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAdminApiSession.mockResolvedValue(null);
    users.revokeMember.mockResolvedValue({ id: "member-1", accessStatus: "REVOKED" });
    users.reactivateMember.mockResolvedValue({ id: "member-1", accessStatus: "ACTIVE" });
    users.resetMemberPassword.mockResolvedValue({ id: "member-1", accessStatus: "ACTIVE" });
  });

  it("uses only the path target for revoke and reactivation", async () => {
    expect((await revoke(request("revoke"), context())).status).toBe(200);
    expect(users.revokeMember).toHaveBeenCalledWith("member-1");
    expect((await reactivate(request("reactivate"), context())).status).toBe(200);
    expect(users.reactivateMember).toHaveBeenCalledWith("member-1");
  });

  it("passes only the reset payload and path target to the password service", async () => {
    const body = { password: "replacement password", confirmPassword: "replacement password" };
    const response = await resetPassword(request("reset-password", body), context());
    expect(response.status).toBe(200);
    expect(users.resetMemberPassword).toHaveBeenCalledWith("member-1", body);
  });

  it("rejects unexpected lifecycle fields instead of accepting role or status assignment", async () => {
    const response = await revoke(request("revoke", { role: "ADMIN", accessStatus: "ACTIVE" }), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(users.revokeMember).not.toHaveBeenCalled();
  });

  it("denies every action to a MEMBER before the service runs", async () => {
    auth.requireAdminApiSession.mockResolvedValue(Response.json({ error: "Administrator access required." }, { status: 403 }));
    expect((await revoke(request("revoke"), context())).status).toBe(403);
    expect((await reactivate(request("reactivate"), context())).status).toBe(403);
    expect((await resetPassword(request("reset-password", {}), context())).status).toBe(403);
    expect(users.revokeMember).not.toHaveBeenCalled();
    expect(users.reactivateMember).not.toHaveBeenCalled();
    expect(users.resetMemberPassword).not.toHaveBeenCalled();
  });
});

function request(action: string, body?: unknown): Request {
  return new Request(`http://localhost:3000/api/admin/users/member-1/${action}`, {
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function context(): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id: "member-1" }) };
}
