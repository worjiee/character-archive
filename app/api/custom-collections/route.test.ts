import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
}));

const customCollections = vi.hoisted(() => ({
  listUserCollections: vi.fn(),
  createUserCollection: vi.fn(),
}));

const errors = vi.hoisted(() => ({
  ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
  readOwnerJson: vi.fn(async (req) => req.json()),
}));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/collections/custom-collections", () => customCollections);
vi.mock("../owner-errors", () => errors);

import { GET, POST } from "./route";

const PRINCIPAL = { userId: "user-a", username: "alice", role: "MEMBER" as const };

describe("/api/custom-collections route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: PRINCIPAL });
  });

  describe("GET", () => {
    it("requires authenticated session", async () => {
      auth.requireUserApiSession.mockResolvedValue(
        Response.json({ error: "Unauthorized" }, { status: 401 })
      );
      const response = await GET(new Request("http://localhost/api/custom-collections"));
      expect(response.status).toBe(401);
      expect(customCollections.listUserCollections).not.toHaveBeenCalled();
    });

    it("returns collections for the authenticated user", async () => {
      customCollections.listUserCollections.mockResolvedValue([
        { id: "col-1", name: "Comfort Bots", characterCount: 3 },
      ]);
      const response = await GET(new Request("http://localhost/api/custom-collections"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(customCollections.listUserCollections).toHaveBeenCalledWith(PRINCIPAL);
      await expect(response.json()).resolves.toEqual({
        collections: [{ id: "col-1", name: "Comfort Bots", characterCount: 3 }],
      });
    });
  });

  describe("POST", () => {
    it("creates a new collection", async () => {
      customCollections.createUserCollection.mockResolvedValue({
        id: "col-new",
        name: "Fantasy RP",
        characterCount: 0,
      });

      const request = new Request("http://localhost/api/custom-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Fantasy RP" }),
      });

      const response = await POST(request);
      expect(response.status).toBe(201);
      expect(customCollections.createUserCollection).toHaveBeenCalledWith(PRINCIPAL, {
        name: "Fantasy RP",
        description: undefined,
      });
      await expect(response.json()).resolves.toEqual({
        collection: { id: "col-new", name: "Fantasy RP", characterCount: 0 },
      });
    });
  });
});
