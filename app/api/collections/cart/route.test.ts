import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const collections = vi.hoisted(() => ({
  addCharactersToCart: vi.fn(),
  assertCharacterCollectionInputKeys: vi.fn((value: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("unexpected field");
  }),
  parseCharacterIds: vi.fn((value: unknown) => value),
}));
const errors = vi.hoisted(() => ({
  readOwnerJson: vi.fn((request: Request) => request.json()),
  ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 400 })),
}));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/characters/collections", () => collections);
vi.mock("../../owner-errors", () => errors);

import { POST } from "./route";

describe("POST /api/collections/cart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: PRINCIPAL });
    collections.addCharactersToCart.mockResolvedValue({ added: 2, count: 3, characterIds: ["character-1", "character-2"] });
  });

  it("requires owner authorization", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await requestBulk();
    expect(response.status).toBe(401);
    expect(collections.addCharactersToCart).not.toHaveBeenCalled();
  });

  it("adds selected canonical IDs to Cart through the bulk service", async () => {
    const response = await requestBulk();
    expect(response.status).toBe(200);
    expect(collections.parseCharacterIds).toHaveBeenCalledWith(["character-1", "character-2"]);
    expect(collections.addCharactersToCart).toHaveBeenCalledWith(PRINCIPAL, ["character-1", "character-2"]);
    await expect(response.json()).resolves.toMatchObject({ added: 2, count: 3 });
  });

  it("rejects a forged bulk userId", async () => {
    const response = await requestBulk({ characterIds: ["character-1"], userId: "user-b" });
    expect(response.status).toBe(400);
    expect(collections.addCharactersToCart).not.toHaveBeenCalled();
  });
});

function requestBulk(body: Record<string, unknown> = { characterIds: ["character-1", "character-2"] }): Promise<Response> {
  return POST(new Request("http://localhost/api/collections/cart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
}

const PRINCIPAL = { userId: "user-a", username: "alice", displayName: "Alice", role: "ADMIN" };
