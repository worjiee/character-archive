import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const checkout = vi.hoisted(() => {
  class CharacterCartCheckoutValidationError extends Error {}
  class CharacterCartCheckoutSizeError extends Error {}
  return {
    CHARACTER_CART_CHECKOUT_FILENAME: "character-archive-checkout.zip",
    CharacterCartCheckoutValidationError,
    CharacterCartCheckoutSizeError,
    parseCharacterCartCheckoutBody: vi.fn((body: Record<string, unknown>) => {
      if (Object.keys(body).some((key) => key !== "characterIds")) {
        throw new CharacterCartCheckoutValidationError("Request must contain only characterIds.");
      }
      return body.characterIds as string[];
    }),
    getCharacterCartCheckoutItems: vi.fn(),
    createCharacterCartCheckoutZip: vi.fn(),
  };
});

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/characters/cart-checkout", () => checkout);

import { POST } from "./route";

describe("POST /api/collections/cart/checkout/zip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: PRINCIPAL });
    checkout.getCharacterCartCheckoutItems.mockResolvedValue([{ id: "character-1" }]);
    checkout.createCharacterCartCheckoutZip.mockReturnValue({ bytes: new Uint8Array([80, 75, 3, 4]), manifest: {} });
  });

  it("requires the normal authenticated user session", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    const response = await POST(request({ characterIds: ["character-1"] }));
    expect(response.status).toBe(401);
    expect(checkout.getCharacterCartCheckoutItems).not.toHaveBeenCalled();
  });

  it("returns a private ZIP attachment for only the authenticated user's resolved selection", async () => {
    const response = await POST(request({ characterIds: ["character-1"] }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="character-archive-checkout.zip"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(checkout.getCharacterCartCheckoutItems).toHaveBeenCalledWith(PRINCIPAL, ["character-1"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([80, 75, 3, 4]));
  });

  it("rejects forged ownership fields and unavailable cross-user Cart IDs without leakage", async () => {
    const forged = await POST(request({ characterIds: ["character-1"], userId: "user-b" }));
    expect(forged.status).toBe(400);
    expect(checkout.getCharacterCartCheckoutItems).not.toHaveBeenCalled();

    checkout.getCharacterCartCheckoutItems.mockResolvedValue([]);
    const unavailable = await POST(request({ characterIds: ["only-user-b-has-this"] }));
    expect(unavailable.status).toBe(409);
    await expect(unavailable.json()).resolves.toEqual({
      error: { code: "CART_CHANGED", message: "One or more selected characters are no longer available in your Cart." },
    });
    expect(checkout.createCharacterCartCheckoutZip).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and does not leak backend failure details", async () => {
    const malformed = await POST(new Request("http://localhost:3000/api/collections/cart/checkout/zip", {
      method: "POST",
      body: "{",
    }));
    expect(malformed.status).toBe(400);

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    checkout.getCharacterCartCheckoutItems.mockRejectedValue(new Error("database C:\\private\\archive"));
    const failed = await POST(request({ characterIds: ["character-1"] }));
    expect(failed.status).toBe(500);
    expect(await failed.text()).toBe('{"error":{"code":"CHECKOUT_FAILED","message":"The ZIP checkout could not be prepared."}}');
    consoleError.mockRestore();
  });
});

function request(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/collections/cart/checkout/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const PRINCIPAL = { userId: "user-a", username: "alice", displayName: "Alice", role: "MEMBER" };
