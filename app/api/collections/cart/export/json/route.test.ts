import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const exporter = vi.hoisted(() => ({
  CHARACTER_CART_EXPORT_FILENAME: "character-archive-cart.json",
  getCharacterCartExport: vi.fn(),
}));
const collections = vi.hoisted(() => {
  class CharacterCollectionValidationError extends Error {}
  return {
    CharacterCollectionValidationError,
    assertCharacterCollectionInputKeys: vi.fn((value: Record<string, unknown>, allowed: string[]) => {
      if (Object.keys(value).some((key) => !allowed.includes(key))) {
        throw new CharacterCollectionValidationError("Request contains an unexpected field.");
      }
    }),
    parseCharacterIds: vi.fn((value: unknown) => {
      if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
        throw new CharacterCollectionValidationError("characterIds contains an invalid Character ID.");
      }
      return [...new Set(value as string[])];
    }),
  };
});

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/characters/cart-export", () => exporter);
vi.mock("@/src/lib/characters/collections", () => collections);

import { GET } from "./route";

describe("GET /api/collections/cart/export/json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: PRINCIPAL });
    exporter.getCharacterCartExport.mockResolvedValue({
      schema: "character-archive.normalized-character-cart",
      version: 1,
      characters: [{ name: "Theron" }],
    });
  });

  it("requires the normal owner session", async () => {
    auth.requireUserApiSession.mockResolvedValue(
      Response.json({ error: "Authentication required." }, { status: 401 }),
    );
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(exporter.getCharacterCartExport).not.toHaveBeenCalled();
  });

  it("downloads the explicit Cart JSON bundle with private safe headers", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="character-archive-cart.json"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(exporter.getCharacterCartExport).toHaveBeenCalledWith(PRINCIPAL, undefined);
    await expect(response.json()).resolves.toMatchObject({
      version: 1,
      characters: [{ name: "Theron" }],
    });
  });

  it("downloads only the selected canonical Cart IDs", async () => {
    exporter.getCharacterCartExport.mockResolvedValue({
      schema: "character-archive.normalized-character-cart",
      version: 1,
      characters: [{ name: "Theron" }, { name: "Jude" }],
    });
    const response = await GET(request("?characterId=character-1&characterId=character-2"));
    expect(response.status).toBe(200);
    expect(exporter.getCharacterCartExport).toHaveBeenCalledWith(PRINCIPAL, ["character-1", "character-2"]);
  });

  it("rejects invalid IDs and stale Cart selection safely", async () => {
    const invalid = await GET(request("?characterId=..%2Fsecret"));
    expect(invalid.status).toBe(400);
    expect(exporter.getCharacterCartExport).not.toHaveBeenCalled();

    exporter.getCharacterCartExport.mockResolvedValue({
      schema: "character-archive.normalized-character-cart",
      version: 1,
      characters: [{ name: "Theron" }],
    });
    const stale = await GET(request("?characterId=character-1&characterId=character-2"));
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({
      error: { code: "CART_CHANGED", message: "One or more selected characters are no longer in Cart." },
    });
  });

  it("rejects a forged userId query instead of changing export ownership", async () => {
    const response = await GET(request("?userId=user-b"));
    expect(response.status).toBe(400);
    expect(exporter.getCharacterCartExport).not.toHaveBeenCalled();
  });

  it("returns a safe conflict when the Cart is empty", async () => {
    exporter.getCharacterCartExport.mockResolvedValue({
      schema: "character-archive.normalized-character-cart",
      version: 1,
      characters: [],
    });
    const response = await GET(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: { code: "EMPTY_CART", message: "Cart is empty." },
    });
  });

  it("does not leak backend failure details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exporter.getCharacterCartExport.mockRejectedValue(new Error("database C:\\private\\archive"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":{"code":"EXPORT_FAILED","message":"The Cart export could not be prepared."}}');
    consoleError.mockRestore();
  });
});

function request(search = ""): Request {
  return new Request(`http://localhost:3000/api/collections/cart/export/json${search}`);
}

const PRINCIPAL = { userId: "user-a", username: "alice", displayName: "Alice", role: "ADMIN" };
