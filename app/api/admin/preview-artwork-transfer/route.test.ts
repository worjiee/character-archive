import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireAdminApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
}));
const transfer = vi.hoisted(() => ({
  readPreviewArtworkTransferRuntime: vi.fn(),
  verifyPreviewArtworkOperatorSecret: vi.fn(),
  loadPreviewArtworkManifest: vi.fn(),
  reconcilePreviewArtworkInventory: vi.fn(),
  loadApprovedPreviewArtwork: vi.fn(),
  issuePreviewArtworkUploadCapability: vi.fn(),
  verifyPreviewArtworkObject: vi.fn(),
}));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/src/lib/artwork/preview-transfer", () => ({
  ...transfer,
  PreviewArtworkTransferError: class PreviewArtworkTransferError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
      super(message);
    }
  },
}));

import { POST } from "./route";

describe("temporary Preview artwork transfer route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAdminApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "session-1",
      principal: { userId: "initial-admin", role: "ADMIN" },
    });
    transfer.readPreviewArtworkTransferRuntime.mockReturnValue({ credentials: {}, expiresAt: new Date() });
    transfer.verifyPreviewArtworkOperatorSecret.mockResolvedValue(true);
    transfer.loadPreviewArtworkManifest.mockResolvedValue([{ sha256: "a".repeat(64) }]);
    transfer.reconcilePreviewArtworkInventory.mockResolvedValue({ expected: 83, present: 0, missing: 83, unexpected: 0 });
    transfer.loadApprovedPreviewArtwork.mockResolvedValue({ sha256: "a".repeat(64) });
    transfer.issuePreviewArtworkUploadCapability.mockResolvedValue("https://blob.vercel-storage.com/capability");
    transfer.verifyPreviewArtworkObject.mockResolvedValue(undefined);
  });

  it("requires the normal ADMIN session before inspecting transfer configuration", async () => {
    auth.requireAdminApiSession.mockResolvedValue(Response.json({ error: "Administrator access required." }, { status: 403 }));
    const response = await POST(request({ action: "preflight" }));
    expect(response.status).toBe(403);
    expect(transfer.readPreviewArtworkTransferRuntime).not.toHaveBeenCalled();
  });

  it("requires the separate one-time operator secret", async () => {
    transfer.verifyPreviewArtworkOperatorSecret.mockResolvedValue(false);
    const response = await POST(request({ action: "preflight" }));
    expect(response.status).toBe(403);
    expect(transfer.loadPreviewArtworkManifest).not.toHaveBeenCalled();
  });

  it("requires an empty managed prefix during preflight", async () => {
    transfer.reconcilePreviewArtworkInventory.mockResolvedValue({ expected: 83, present: 1, missing: 82, unexpected: 0 });
    const response = await POST(request({ action: "preflight" }));
    expect(response.status).toBe(409);
  });

  it("returns only an exact server-issued capability for an approved digest", async () => {
    const digest = "a".repeat(64);
    const response = await POST(request({ action: "capability", sha256: digest }));
    expect(response.status).toBe(200);
    expect(transfer.loadApprovedPreviewArtwork).toHaveBeenCalledWith({}, digest);
    await expect(response.json()).resolves.toMatchObject({ sha256: digest, expiresInSeconds: 300 });
  });

  it("rejects client-provided storage keys", async () => {
    const response = await POST(request({
      action: "capability",
      sha256: "a".repeat(64),
      storageKey: "artwork/sha256/arbitrary.png",
    }));
    expect(response.status).toBe(400);
    expect(transfer.issuePreviewArtworkUploadCapability).not.toHaveBeenCalled();
  });

  it("fails final inventory unless all 83 exact objects are present", async () => {
    transfer.reconcilePreviewArtworkInventory.mockResolvedValue({ expected: 83, present: 82, missing: 1, unexpected: 0 });
    const response = await POST(request({ action: "inventory" }));
    expect(response.status).toBe(409);
  });

  it("maps a native Blob 403 to a safe hard-stop code", async () => {
    transfer.issuePreviewArtworkUploadCapability.mockRejectedValue(new Error("upstream request failed: 403 Forbidden"));
    const response = await POST(request({ action: "capability", sha256: "a".repeat(64) }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BLOB_AUTH_FORBIDDEN", message: "Preview Blob authorization was forbidden." },
    });
  });
});

function request(body: Record<string, unknown>): Request {
  const encoded = JSON.stringify(body);
  return new Request("https://preview.example/api/admin/preview-artwork-transfer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(encoded, "utf8")),
      "Origin": "https://preview.example",
      "x-preview-artwork-transfer-secret": "operator phrase",
    },
    body: encoded,
  });
}
