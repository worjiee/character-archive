import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
}));
const browse = vi.hoisted(() => ({
  getRandomCharacter: vi.fn(),
}));
const errors = vi.hoisted(() => ({
  ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
}));

vi.mock("../../../../src/lib/auth", () => auth);
vi.mock("../../../../src/lib/characters/browse", () => browse);
vi.mock("../../owner-errors", () => errors);

import { GET } from "./route";

describe("GET /api/characters/random", () => {
  const mockPrincipal = { userId: "user-1", username: "tester", role: "MEMBER" };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: mockPrincipal });
    browse.getRandomCharacter.mockResolvedValue({
      characterId: "char-123",
      totalCandidates: 42,
    });
  });

  it("requires authentication", async () => {
    auth.requireUserApiSession.mockResolvedValue(
      Response.json({ error: "Authentication required." }, { status: 401 }),
    );

    const request = new Request("http://localhost/api/characters/random");
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(browse.getRandomCharacter).not.toHaveBeenCalled();
  });

  it("returns random character and total candidates", async () => {
    const request = new Request("http://localhost/api/characters/random?source=JANITOR_AI&tokenMax=3000");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ characterId: "char-123", totalCandidates: 42 });

    expect(browse.getRandomCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ["JANITOR_AI"],
        tokenMax: 3000,
      }),
      mockPrincipal,
      { excludeId: undefined },
    );
  });

  it("passes excludeId when provided in query parameters", async () => {
    const request = new Request("http://localhost/api/characters/random?excludeId=prev-char-999");
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(browse.getRandomCharacter).toHaveBeenCalledWith(
      expect.anything(),
      mockPrincipal,
      { excludeId: "prev-char-999" },
    );
  });

  it("returns null characterId when no candidates match", async () => {
    browse.getRandomCharacter.mockResolvedValue({
      characterId: null,
      totalCandidates: 0,
    });

    const request = new Request("http://localhost/api/characters/random?q=Nonexistent");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual({ characterId: null, totalCandidates: 0 });
  });

  it("sets Cache-Control: private, no-store", async () => {
    const request = new Request("http://localhost/api/characters/random");
    const response = await GET(request);

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
