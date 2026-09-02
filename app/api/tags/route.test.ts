import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn() }));
const tags = vi.hoisted(() => ({ searchCatalogTags: vi.fn() }));
const errors = vi.hoisted(() => ({ ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })) }));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/tags/search", () => tags);
vi.mock("../owner-errors", () => errors);

import { GET } from "./route";

describe("GET /api/tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    tags.searchCatalogTags.mockResolvedValue({ items: [], page: 1, limit: 50, total: 0, hasMore: false });
  });

  it("requires an authenticated same-origin session", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Unauthorized" }, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/tags"));
    expect(response.status).toBe(401);
    expect(tags.searchCatalogTags).not.toHaveBeenCalled();
  });

  it("returns a bounded private catalog result", async () => {
    const response = await GET(new Request("http://localhost/api/tags?q=Male&source=JANITOR_AI&page=2&limit=50"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(tags.searchCatalogTags).toHaveBeenCalledWith({ query: "Male", source: "JANITOR_AI", page: 2, limit: 50 });
  });

  it("rejects unknown vocabulary sources instead of mapping Janny to Other", async () => {
    const response = await GET(new Request("http://localhost/api/tags?source=JANNY"));
    expect(response.status).toBe(400);
    expect(tags.searchCatalogTags).not.toHaveBeenCalled();
  });
});
