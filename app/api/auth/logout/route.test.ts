import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  invalidateUserSession: vi.fn(),
  isSameOriginWhenPresent: vi.fn(() => true),
  LEGACY_OWNER_SESSION_COOKIE: "character_archive_session",
  readRequestCookie: vi.fn(() => "A".repeat(43)),
  USER_SESSION_COOKIE: "character_archive_user_session",
}));
vi.mock("@/src/lib/auth", () => auth);

import { POST } from "./route";

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.isSameOriginWhenPresent.mockReturnValue(true);
  });

  it("deletes only the presented hashed-token session and expires new and legacy cookies", async () => {
    const request = new Request("http://localhost:3000/api/auth/logout", { method: "POST" });
    const response = await POST(request);
    expect(response.status).toBe(303);
    expect(auth.invalidateUserSession).toHaveBeenCalledWith("A".repeat(43));
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies).toContain("character_archive_user_session=");
    expect(cookies).toContain("character_archive_session=");
  });

  it("rejects a cross-origin logout request", async () => {
    auth.isSameOriginWhenPresent.mockReturnValue(false);
    const response = await POST(new Request("http://localhost:3000/api/auth/logout", { method: "POST" }));
    expect(response.status).toBe(403);
    expect(auth.invalidateUserSession).not.toHaveBeenCalled();
  });
});
