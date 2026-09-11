import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const service = vi.hoisted(() => ({ FavoriteCreatorValidationError: class FavoriteCreatorValidationError extends Error {}, listFavoriteCreators: vi.fn(), parseFavoriteCreatorIdentity: vi.fn(), setManualFavoriteCreator: vi.fn() }));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/favorite-creators", () => service);

import { GET, PUT } from "./route";

const identity = { platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "creator-1" } as const;
const session = { principal: { userId: "member-1", role: "MEMBER", username: "member", displayName: null } };

describe("/api/favorite-creators", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue(session);
    service.parseFavoriteCreatorIdentity.mockReturnValue(identity);
    service.listFavoriteCreators.mockResolvedValue({ items: [], nextCursor: null });
    service.setManualFavoriteCreator.mockResolvedValue({ present: true, provenance: ["MANUAL"] });
  });

  it("scopes listing and mutation to the authenticated user", async () => {
    expect((await GET(new Request("http://localhost/api/favorite-creators?limit=25"))).status).toBe(200);
    expect(service.listFavoriteCreators).toHaveBeenCalledWith("member-1", { cursor: undefined, limit: 25 });
    const response = await PUT(request({ platform: "JANITOR_AI", identityKind: "EXTERNAL_ID", identityValue: "creator-1", present: true }));
    expect(response.status).toBe(200);
    expect(service.setManualFavoriteCreator).toHaveBeenCalledWith("member-1", identity, true);
  });

  it("rejects arbitrary user IDs and malformed state", async () => {
    expect((await PUT(request({ platform: "JANITOR_AI", identityKind: "EXTERNAL_ID", identityValue: "creator-1", present: true, userId: "other" }))).status).toBe(400);
    expect((await PUT(request({ platform: "JANITOR_AI", identityKind: "EXTERNAL_ID", identityValue: "creator-1", present: "yes" }))).status).toBe(400);
    expect(service.setManualFavoriteCreator).not.toHaveBeenCalled();
  });

  it("stops before data access when authentication fails", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    expect((await GET(new Request("http://localhost/api/favorite-creators"))).status).toBe(401);
    expect((await PUT(request({}))).status).toBe(401);
    expect(service.listFavoriteCreators).not.toHaveBeenCalled();
  });
});

function request(body: unknown) {
  return new Request("http://localhost/api/favorite-creators", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
