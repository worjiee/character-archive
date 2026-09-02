import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const jobs = vi.hoisted(() => ({ getImportPreviewArtworkBinding: vi.fn() }));
const artwork = vi.hoisted(() => ({ readPreparedArtwork: vi.fn() }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/lib/prisma", () => ({ prisma: { marker: "database" } }));
vi.mock("@/src/lib/importers/preview-jobs", () => jobs);
vi.mock("@/src/lib/artwork/index", () => ({
  readPreparedArtwork: artwork.readPreparedArtwork,
  artworkResponse: (bytes: Uint8Array) => new Response(Buffer.from(bytes), { headers: { "Content-Type": "image/png" } }),
}));
vi.mock("../../../errors", () => ({
  importErrorResponse: (error: { status?: number }) => Response.json({ error: "hidden" }, { status: error.status ?? 500 }),
}));

import { GET } from "./route";

describe("session-owned preview artwork route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ sessionId: "session-a", principal: { userId: "user-a", role: "MEMBER" } });
    jobs.getImportPreviewArtworkBinding.mockResolvedValue({ sha256: "a".repeat(64), expiresAt: "2026-09-01T01:00:00.000Z" });
    artwork.readPreparedArtwork.mockResolvedValue(Uint8Array.of(1, 2, 3));
  });

  it("uses the authenticated session identity and never a client-supplied pending key", async () => {
    const response = await GET(new Request("http://localhost/api/import/previews/job-a/artwork"), {
      params: Promise.resolve({ id: "job-a" }),
    });
    expect(response.status).toBe(200);
    expect(jobs.getImportPreviewArtworkBinding).toHaveBeenCalledWith("session-a", "job-a", expect.any(Object));
  });

  it("does not expose a preview owned by another session", async () => {
    jobs.getImportPreviewArtworkBinding.mockRejectedValue(Object.assign(new Error("not found"), { status: 404 }));
    const response = await GET(new Request("http://localhost/api/import/previews/job-b/artwork"), {
      params: Promise.resolve({ id: "job-b" }),
    });
    expect(response.status).toBe(404);
    expect(artwork.readPreparedArtwork).not.toHaveBeenCalled();
  });
});
