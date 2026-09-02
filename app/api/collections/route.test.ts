import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const collections = vi.hoisted(() => ({ assertCharacterCollectionInputKeys: vi.fn(), getCharacterCollectionState: vi.fn() }));
const errors = vi.hoisted(() => ({ ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })) }));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/characters/collections", () => collections);
vi.mock("../owner-errors", () => errors);

import { GET } from "./route";

describe("GET /api/collections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: PRINCIPAL });
    collections.getCharacterCollectionState.mockResolvedValue({ favoriteIds: ["favorite-1"], cartIds: ["cart-1"] });
  });

  it("requires owner authorization", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/collections"));
    expect(response.status).toBe(401);
    expect(collections.getCharacterCollectionState).not.toHaveBeenCalled();
  });

  it("returns private persistent collection state", async () => {
    const response = await GET(new Request("http://localhost/api/collections"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(collections.getCharacterCollectionState).toHaveBeenCalledWith(PRINCIPAL);
    await expect(response.json()).resolves.toEqual({ collections: { favoriteIds: ["favorite-1"], cartIds: ["cart-1"] } });
  });
});

const PRINCIPAL = { userId: "user-a", username: "alice", displayName: "Alice", role: "ADMIN" };
