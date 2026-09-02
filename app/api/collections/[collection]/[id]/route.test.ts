import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const collections = vi.hoisted(() => ({
  assertCharacterCollectionInputKeys: vi.fn((value: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("unexpected field");
  }),
  parseCharacterCollectionKind: vi.fn((value: string) => value),
  parseCharacterCollectionPresence: vi.fn((value: unknown) => value),
  setCharacterCollectionMembership: vi.fn(),
}));
const errors = vi.hoisted(() => ({
  readOwnerJson: vi.fn((request: Request) => request.json()),
  ownerErrorResponse: vi.fn(() => Response.json({ error: { code: "INVALID_REQUEST", message: "Invalid request." } }, { status: 400 })),
}));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/characters/collections", () => collections);
vi.mock("../../../owner-errors", () => errors);

import { PUT } from "./route";

describe("PUT /api/collections/:collection/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: PRINCIPAL });
    collections.setCharacterCollectionMembership.mockResolvedValue({ collection: "favorites", characterId: "character-1", present: true, count: 1 });
  });

  it("requires owner authorization before parsing or mutation", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await requestMembership();
    expect(response.status).toBe(401);
    expect(collections.setCharacterCollectionMembership).not.toHaveBeenCalled();
  });

  it("sets explicit collection membership for a canonical Character ID", async () => {
    const response = await requestMembership();
    expect(response.status).toBe(200);
    expect(collections.parseCharacterCollectionKind).toHaveBeenCalledWith("favorites");
    expect(collections.parseCharacterCollectionPresence).toHaveBeenCalledWith(true);
    expect(collections.setCharacterCollectionMembership).toHaveBeenCalledWith(PRINCIPAL, "favorites", "character-1", true);
  });

  it("rejects a forged userId instead of switching collection ownership", async () => {
    const response = await requestMembership({ present: true, userId: "user-b" });
    expect(response.status).toBe(400);
    expect(collections.setCharacterCollectionMembership).not.toHaveBeenCalled();
  });

  it("maps validation failures to a safe owner-facing response", async () => {
    collections.parseCharacterCollectionKind.mockImplementationOnce(() => { throw new Error("bad details"); });
    const response = await requestMembership();
    expect(response.status).toBe(400);
    expect(errors.ownerErrorResponse).toHaveBeenCalledOnce();
  });
});

function requestMembership(body: Record<string, unknown> = { present: true }): Promise<Response> {
  return PUT(
    new Request("http://localhost/api/collections/favorites/character-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ collection: "favorites", id: "character-1" }) },
  );
}

const PRINCIPAL = { userId: "user-a", username: "alice", displayName: "Alice", role: "ADMIN" };
