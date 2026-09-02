import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn() }));
const authors = vi.hoisted(() => ({ searchAuthorTags: vi.fn() }));
const errors = vi.hoisted(() => ({ ownerErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })) }));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/authors/browse", () => authors);
vi.mock("../../../../owner-errors", () => errors);

import { GET } from "./route";

describe("GET author tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    authors.searchAuthorTags.mockResolvedValue({ items: [], page: 1, limit: 30, total: 0, hasMore: false });
  });

  it("requires an authenticated same-origin session", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    const response = await GET(new Request("http://localhost/api/authors/JANITOR_AI/id~creator-1/tags"), { params: Promise.resolve({ platform: "JANITOR_AI", creatorId: "id~creator-1" }) });
    expect(response.status).toBe(401);
    expect(authors.searchAuthorTags).not.toHaveBeenCalled();
  });

  it("returns a private bounded source-author vocabulary", async () => {
    const response = await GET(new Request("http://localhost/api/authors/JANITOR_AI/id~creator-1/tags?q=Male&page=2&limit=30"), { params: Promise.resolve({ platform: "JANITOR_AI", creatorId: "id~creator-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(authors.searchAuthorTags).toHaveBeenCalledWith({ platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "creator-1" }, { query: "Male", page: 2, limit: 30 });
  });

  it("rejects Janny and unknown query fields", async () => {
    const janny = await GET(new Request("http://localhost/api/authors/JANNY/id~creator/tags"), { params: Promise.resolve({ platform: "JANNY", creatorId: "id~creator" }) });
    expect(janny.status).toBe(404);
    const invalid = await GET(new Request("http://localhost/api/authors/JANITOR_AI/id~creator/tags?orderBy=count"), { params: Promise.resolve({ platform: "JANITOR_AI", creatorId: "id~creator" }) });
    expect(invalid.status).toBe(400);
  });
});
