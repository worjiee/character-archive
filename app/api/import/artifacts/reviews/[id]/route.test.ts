import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const fallback = vi.hoisted(() => ({ detail: vi.fn(), createFallbackReviewPreview: vi.fn() }));
const database = vi.hoisted(() => ({ prisma: { local: true } }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/importers/fallback-review", () => ({
  FallbackReviewError: class FallbackReviewError extends Error {
    code = "REVIEW_NOT_FOUND";
    status = 404;
  },
  fallbackReviewStore: { detail: fallback.detail },
  createFallbackReviewPreview: fallback.createFallbackReviewPreview,
}));
vi.mock("@/lib/prisma", () => database);

import { GET, POST } from "./route";

describe("fallback review API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ sessionId: "session-a" });
    fallback.detail.mockReturnValue({ reviewId: "review-123", displayName: "Private" });
    fallback.createFallbackReviewPreview.mockResolvedValue({ previewJobId: "preview-123456789", expiresAt: "2026-09-01T00:15:00.000Z", preview: { name: "Reviewed" } });
  });

  it("loads only the authenticated session's opaque fallback candidate", async () => {
    const response = await GET(new Request("http://localhost/api/import/artifacts/reviews/review-123"), context("review-123"));
    expect(response.status).toBe(200);
    expect(fallback.detail).toHaveBeenCalledWith("session-a", "review-123");
  });

  it("creates one immutable preview from server-bound review state", async () => {
    const mapping = { name: "Reviewed", description: "Mapped", personality: "", scenario: "", firstGreeting: "", alternateGreetings: [], exampleDialogs: "", tags: [] };
    const response = await POST(new Request("http://localhost/api/import/artifacts/reviews/review-123", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(mapping),
    }), context("review-123"));
    expect(response.status).toBe(201);
    expect(fallback.createFallbackReviewPreview).toHaveBeenCalledWith("session-a", "review-123", mapping, { client: database.prisma });
  });

  it("does not inspect or create reviews when authentication fails", async () => {
    auth.requireUserApiSession.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await GET(new Request("http://localhost"), context("review-123"))).status).toBe(401);
    expect(fallback.detail).not.toHaveBeenCalled();
  });
});

function context(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}
