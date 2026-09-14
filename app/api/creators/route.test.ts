import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
}));
const authors = vi.hoisted(() => ({ browseAuthors: vi.fn() }));
const errors = vi.hoisted(() => ({ ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })) }));

vi.mock("../../../src/lib/auth", () => auth);
vi.mock("../../../src/lib/authors/browse", () => authors);
vi.mock("../owner-errors", () => errors);

import { GET } from "./route";

describe("GET /api/creators", () => {
  const mockPrincipal = { userId: "user-1", username: "tester", role: "MEMBER" };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ principal: mockPrincipal });
    authors.browseAuthors.mockResolvedValue({
      items: [
        {
          identity: { platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "cr_123" },
          creatorName: "SEPHA",
          characterCount: 15,
          latestPublishedAt: new Date(),
          tagPreview: [],
          isFavorited: false,
          favoriteProvenance: [],
        },
        {
          identity: { platform: "SAUCEPAN", kind: "CREATOR_NAME", value: "alice" },
          creatorName: "Alice",
          characterCount: 3,
          latestPublishedAt: new Date(),
          tagPreview: [],
          isFavorited: false,
          favoriteProvenance: [],
        },
      ],
      pagination: { page: 1, pageSize: 20, hasPrevious: false, hasNext: false },
    });
  });

  it("requires an authenticated user session", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/creators"));
    expect(response.status).toBe(401);
    expect(authors.browseAuthors).not.toHaveBeenCalled();
  });

  it("returns creator autocomplete items with canonical keys", async () => {
    const response = await GET(new Request("http://localhost/api/creators?q=sep&limit=10"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authors.browseAuthors).toHaveBeenCalledWith(
      {
        query: "sep",
        source: "ALL",
        sort: "characters-desc",
        favoriteOnly: false,
        page: 1,
        pageSize: 10,
      },
      mockPrincipal,
    );
    const data = await response.json();
    expect(data.items).toEqual([
      {
        key: "JANITOR_AI:EXTERNAL_ID:cr_123",
        name: "SEPHA",
        platform: "JANITOR_AI",
        characterCount: 15,
        identity: { platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "cr_123" },
      },
      {
        key: "SAUCEPAN:CREATOR_NAME:alice",
        name: "Alice",
        platform: "SAUCEPAN",
        characterCount: 3,
        identity: { platform: "SAUCEPAN", kind: "CREATOR_NAME", value: "alice" },
      },
    ]);
  });
});
