import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAuthenticatedUserApiSession: vi.fn(),
  requireUserApiSession: vi.fn(),
}));
const artifacts = vi.hoisted(() => ({
  inspectArtifact: vi.fn(),
}));
const jobs = vi.hoisted(() => ({
  cleanupImportPreviewJobs: vi.fn(),
  prepareImportPreviewJob: vi.fn(),
  persistPreparedImportPreviewJobs: vi.fn(),
}));
const database = vi.hoisted(() => ({
  prisma: { $transaction: vi.fn(async (run: (tx: object) => unknown) => run({ transaction: true })) },
}));
const fallback = vi.hoisted(() => ({ registerBatch: vi.fn(), discardBatch: vi.fn() }));
const artwork = vi.hoisted(() => ({
  getArtworkObjectStore: vi.fn(),
  preparePendingArtwork: vi.fn(),
  cleanupExpiredPending: vi.fn(),
  deletePending: vi.fn(),
}));
const deployment = vi.hoisted(() => ({ artifactUploadEnabled: true }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/importers/artifacts", () => ({
  ARTIFACT_LIMITS: { compressedBytes: 256 * 1024 * 1024 },
  ARTIFACT_UPLOAD_LIMIT_LABEL: "256 MiB",
  validateArtifactUploadByteLength: (size: number) => size > 0 && size <= 256 * 1024 * 1024 ? null : "This archive is larger than the 256 MiB upload limit.",
  ArtifactImportError: class ArtifactImportError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 422) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  inspectArtifact: artifacts.inspectArtifact,
}));
vi.mock("@/src/lib/importers/preview-jobs", () => jobs);
vi.mock("@/src/lib/importers/fallback-review", () => ({
  FallbackReviewError: class FallbackReviewError extends Error {},
  fallbackReviewStore: fallback,
}));
vi.mock("@/src/lib/artwork/index", () => ({
  ArtworkStorageConfigurationError: class ArtworkStorageConfigurationError extends Error {},
  getArtworkObjectStore: artwork.getArtworkObjectStore,
  preparePendingArtwork: artwork.preparePendingArtwork,
}));
vi.mock("@/lib/prisma", () => database);
vi.mock("@/src/lib/runtime/deployment", () => ({
  isArtifactUploadEnabled: () => deployment.artifactUploadEnabled,
}));

import { POST } from "./route";

describe("artifact import route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deployment.artifactUploadEnabled = true;
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({ sessionId: "session-a", principal: { userId: "user-a", role: "MEMBER" } });
    jobs.cleanupImportPreviewJobs.mockResolvedValue(0);
    artwork.getArtworkObjectStore.mockReturnValue({
      cleanupExpiredPending: artwork.cleanupExpiredPending,
      deletePending: artwork.deletePending,
    });
    artwork.cleanupExpiredPending.mockResolvedValue(0);
    artwork.deletePending.mockResolvedValue(undefined);
    fallback.registerBatch.mockReturnValue([]);
    jobs.prepareImportPreviewJob.mockImplementation(async (_session: string, character: { name: string }) => ({
      previewJobId: "", expiresAt: "2026-09-01T00:15:00.000Z", preview: { name: character.name }, record: { externalId: character.name },
    }));
    jobs.persistPreparedImportPreviewJobs.mockImplementation(async (prepared: Array<{ preview: { name: string } }>) =>
      prepared.map((entry) => ({
        previewJobId: `job-${entry.preview.name}`,
        expiresAt: "2026-09-01T00:15:00.000Z",
        preview: entry.preview,
      })),
    );
    artifacts.inspectArtifact.mockReturnValue({
      kind: "ZIP",
      manifest: { present: true, exporterVersion: "1.3.0", declaredTotal: 3, crossCheck: "MATCHED" },
      warnings: [],
      items: [
        { filename: "001_A_aaaaaaaa.png", status: "READY", character: { name: "A" } },
        { filename: "002_B_bbbbbbbb.png", status: "INVALID", code: "PNG_INVALID", message: "bad" },
        { filename: "003_C_cccccccc.png", status: "READY", character: { name: "C" } },
      ],
    });
  });

  it("fails deployed artifact uploads closed after authentication", async () => {
    deployment.artifactUploadEnabled = false;
    const response = await POST(uploadRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "ARTIFACT_UPLOAD_UNAVAILABLE",
        message: "Import uploads are temporarily unavailable in this preview.",
      },
    });
    expect(artifacts.inspectArtifact).not.toHaveBeenCalled();
  });

  it("creates exactly one session-owned preview job per valid character and isolates invalid entries", async () => {
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(jobs.prepareImportPreviewJob).toHaveBeenCalledTimes(2);
    expect(jobs.prepareImportPreviewJob).toHaveBeenNthCalledWith(1, "session-a", { name: "A" }, "artifact-upload", expect.anything());
    expect(jobs.prepareImportPreviewJob).toHaveBeenNthCalledWith(2, "session-a", { name: "C" }, "artifact-upload", expect.anything());
    expect(jobs.persistPreparedImportPreviewJobs).toHaveBeenCalledTimes(1);
    expect(jobs.persistPreparedImportPreviewJobs).toHaveBeenCalledWith(
      [expect.objectContaining({ preview: { name: "A" } }), expect.objectContaining({ preview: { name: "C" } })],
      database.prisma,
    );
    expect(database.prisma.$transaction).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.items).toEqual([
      expect.objectContaining({ filename: "001_A_aaaaaaaa.png", previewJobId: "job-A" }),
      expect.objectContaining({ filename: "002_B_bbbbbbbb.png", status: "INVALID", code: "PNG_INVALID" }),
      expect.objectContaining({ filename: "003_C_cccccccc.png", previewJobId: "job-C" }),
    ]);
  });

  it("prepares uploaded artwork before preview persistence without creating a durable asset", async () => {
    const png = Uint8Array.of(137, 80, 78, 71);
    const binding = {
      sha256: "a".repeat(64), mediaType: "image/png", byteLength: png.byteLength, width: 1, height: 1,
      pendingKey: "pending-artwork/1780000000000/aaaaaaaaaaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000000.png",
      expiresAt: "2026-09-01T01:00:00.000Z",
    };
    artifacts.inspectArtifact.mockReturnValue({
      kind: "PNG", manifest: { present: false }, warnings: [],
      items: [{
        filename: "card.png", status: "READY", character: { name: "Card" },
        artworkPolicy: "PREPARED_UPLOADED_ARTWORK",
        artwork: { metadata: { ...binding, pendingKey: undefined, expiresAt: undefined }, readBytes: () => png },
      }],
    });
    artwork.preparePendingArtwork.mockResolvedValue(binding);

    const response = await POST(uploadRequest(png, "card.png", "image/png"));
    expect(response.status).toBe(200);
    expect(artwork.preparePendingArtwork).toHaveBeenCalledWith(
      "session-a", png, expect.objectContaining({ sha256: binding.sha256 }), expect.any(Object),
    );
    expect(jobs.prepareImportPreviewJob).toHaveBeenCalledWith(
      "session-a", expect.objectContaining({ name: "Card" }), "artifact-upload",
      expect.objectContaining({ artwork: binding }),
    );
    expect(database.prisma).not.toHaveProperty("artworkAsset");
  });

  it("prepares an 83-character metadata workload sequentially without retaining an array of inflated PNG buffers", async () => {
    const png = Uint8Array.of(137, 80, 78, 71);
    let activePreparations = 0;
    let maximumConcurrentPreparations = 0;
    artwork.preparePendingArtwork.mockImplementation(async (_sessionId: string, _bytes: Uint8Array, metadata: { sha256: string }) => {
      activePreparations += 1;
      maximumConcurrentPreparations = Math.max(maximumConcurrentPreparations, activePreparations);
      await Promise.resolve();
      activePreparations -= 1;
      return {
        sha256: metadata.sha256, mediaType: "image/png", byteLength: png.byteLength, width: 1, height: 1,
        pendingKey: `pending-artwork/1780000000000/aaaaaaaaaaaaaaaaaaaaaaaa/${metadata.sha256.slice(0, 8)}-0000-4000-8000-000000000000.png`,
        expiresAt: "2026-09-01T01:00:00.000Z",
      };
    });
    artifacts.inspectArtifact.mockReturnValue({
      kind: "ZIP", manifest: { present: true }, warnings: [],
      items: Array.from({ length: 83 }, (_, index) => ({
        filename: `${index}.png`, status: "READY", character: { name: `Character ${index}` },
        artwork: {
          metadata: { sha256: index.toString(16).padStart(64, "0"), mediaType: "image/png", byteLength: 4, width: 1, height: 1 },
          readBytes: () => png,
        },
      })),
    });

    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(artwork.preparePendingArtwork).toHaveBeenCalledTimes(83);
    expect(maximumConcurrentPreparations).toBe(1);
    expect(jobs.persistPreparedImportPreviewJobs).toHaveBeenCalledWith(expect.any(Array), database.prisma);
  });

  it("requires authentication and a bounded declared upload length", async () => {
    auth.requireUserApiSession.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await POST(uploadRequest())).status).toBe(401);
    expect(artifacts.inspectArtifact).not.toHaveBeenCalled();

    auth.requireUserApiSession.mockResolvedValue(null);
    const unbounded = uploadRequest();
    unbounded.headers.delete("content-length");
    expect((await POST(unbounded)).status).toBe(411);
    expect(artifacts.inspectArtifact).not.toHaveBeenCalled();
  });

  it("registers fallback material server-side and returns only an opaque review summary", async () => {
    const candidate = { displayName: "Private", retainedBytes: 100 };
    artifacts.inspectArtifact.mockReturnValueOnce({
      kind: "ZIP",
      manifest: { present: true, exporterVersion: "1.3.0", declaredTotal: 1, crossCheck: "MATCHED" },
      warnings: [],
      items: [{ filename: "059_Private_deadbeef.txt", status: "FALLBACK_REVIEW_REQUIRED", fallback: candidate }],
    });
    fallback.registerBatch.mockReturnValueOnce([{ reviewId: "review-opaque", displayName: "Private", expiresAt: "2026-09-01T01:00:00.000Z" }]);
    const response = await POST(uploadRequest());
    expect(response.status).toBe(200);
    expect(fallback.registerBatch).toHaveBeenCalledWith("session-a", [candidate]);
    const body = await response.json();
    expect(body.items[0]).toMatchObject({ fallbackReview: { reviewId: "review-opaque", displayName: "Private" } });
    expect(body.items[0]).not.toHaveProperty("fallback");
    expect(jobs.prepareImportPreviewJob).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before reading it", async () => {
    const request = uploadRequest();
    request.headers.set("content-length", String(256 * 1024 * 1024 + 1));
    const response = await POST(request);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { message: expect.stringContaining("256 MiB") } });
    expect(artifacts.inspectArtifact).not.toHaveBeenCalled();
  });

  it("rejects a body that does not match its declared length", async () => {
    const request = uploadRequest();
    request.headers.set("content-length", "5");
    expect((await POST(request)).status).toBe(400);
    expect(artifacts.inspectArtifact).not.toHaveBeenCalled();
  });
});

function uploadRequest(
  bytes = Uint8Array.of(0x50, 0x4b, 3, 4),
  filename = "export.zip",
  contentType = "application/octet-stream",
): Request {
  const request = new Request("http://localhost:3000/api/import/artifacts", {
    method: "POST",
    headers: {
      "content-type": contentType,
      "content-length": String(bytes.byteLength),
      "x-artifact-filename": encodeURIComponent(filename),
    },
    body: bytes,
  });
  return request;
}
