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
vi.mock("@/src/lib/artwork/preview-transfer", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/lib/artwork/preview-transfer")>("../../../../src/lib/artwork/preview-transfer");
  return {
    ...actual,
    ...transfer,
  };
});

import { issueVerificationProof } from "../../../../src/lib/artwork/preview-transfer";
import { POST } from "./route";

describe("temporary Preview artwork transfer route", () => {
  const presentDigests = Array.from({ length: 72 }, (_, i) => i.toString(16).padStart(64, "0"));
  const missingDigests = Array.from({ length: 11 }, (_, i) => (72 + i).toString(16).padStart(64, "0"));
  const manifest = [...presentDigests, ...missingDigests].map((sha256) => ({
    sha256,
    mediaType: "image/png" as const,
    byteLength: 1024,
    width: 100,
    height: 100,
    storageKey: `artwork/sha256/${sha256}.png`,
  }));

  const mockRuntime = {
    credentials: { oidcToken: "token", storeId: "store-1" },
    operatorSecretHash: "$scrypt$N=16384,r=8,p=1$7uU2xQ$dGVzdC1oYXNo",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    expectedProjectId: "project-1",
    expectedStoreId: "store-1",
  };

  const mockInventory = {
    expected: 83,
    present: 72,
    missing: 11,
    unexpected: 0,
    presentDigests,
    missingDigests,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAdminApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "session-1",
      principal: { userId: "initial-admin", role: "ADMIN" },
    });
    transfer.readPreviewArtworkTransferRuntime.mockReturnValue(mockRuntime);
    transfer.verifyPreviewArtworkOperatorSecret.mockResolvedValue(true);
    transfer.loadPreviewArtworkManifest.mockResolvedValue(manifest);
    transfer.reconcilePreviewArtworkInventory.mockResolvedValue(mockInventory);
    transfer.loadApprovedPreviewArtwork.mockImplementation(async (_prisma, sha256) => {
      const item = manifest.find((m) => m.sha256 === sha256);
      if (!item) throw new Error("Not found");
      return item;
    });
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

  it("performs lightweight preflight without bulk object verification", async () => {
    const response = await POST(request({ action: "preflight" }));
    expect(response.status).toBe(200);
    expect(transfer.verifyPreviewArtworkObject).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.inventory).toEqual({ expected: 83, present: 72, missing: 11, unexpected: 0 });
    expect(json.presentDigests).toHaveLength(72);
    expect(json.missingDigests).toHaveLength(11);
  });

  it("rejects preflight if unexpected objects exist in storage", async () => {
    transfer.reconcilePreviewArtworkInventory.mockResolvedValue({
      ...mockInventory,
      unexpected: 1,
    });
    const response = await POST(request({ action: "preflight" }));
    expect(response.status).toBe(409);
  });

  describe("action: verify-batch", () => {
    it("rejects batches with more than 8 objects", async () => {
      const tooMany = presentDigests.slice(0, 9);
      const response = await POST(request({ action: "verify-batch", digests: tooMany }));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.message).toContain("Batch size must be between 1 and 8");
    });

    it("rejects empty batch", async () => {
      const response = await POST(request({ action: "verify-batch", digests: [] }));
      expect(response.status).toBe(400);
    });

    it("rejects digests not currently present in storage", async () => {
      const alienDigest = "f".repeat(64);
      const response = await POST(request({ action: "verify-batch", digests: [alienDigest] }));
      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error.message).toContain("Digest is not present in storage");
    });

    it("verifies a batch of present objects and returns an updated proof token", async () => {
      const batch = presentDigests.slice(0, 8);
      const response = await POST(request({ action: "verify-batch", digests: batch }));
      expect(response.status).toBe(200);
      expect(transfer.verifyPreviewArtworkObject).toHaveBeenCalledTimes(8);
      const json = await response.json();
      expect(json.verifiedDigests).toEqual(batch.sort());
      expect(typeof json.proofToken).toBe("string");
      expect(json.totalVerified).toBe(8);
    });

    it("accumulates proof across multiple batches", async () => {
      const batch1 = presentDigests.slice(0, 8);
      const res1 = await POST(request({ action: "verify-batch", digests: batch1 }));
      const json1 = await res1.json();
      const token1 = json1.proofToken;

      const batch2 = presentDigests.slice(8, 16);
      const res2 = await POST(request({ action: "verify-batch", digests: batch2, proofToken: token1 }));
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.totalVerified).toBe(16);
      expect(json2.verifiedDigests).toEqual([...batch1, ...batch2].sort());
    });

    it("rejects batch containing already-verified digest", async () => {
      const batch1 = presentDigests.slice(0, 8);
      const res1 = await POST(request({ action: "verify-batch", digests: batch1 }));
      const json1 = await res1.json();
      const token1 = json1.proofToken;

      // Repeat a digest from batch1
      const res2 = await POST(request({ action: "verify-batch", digests: [batch1[0]], proofToken: token1 }));
      expect(res2.status).toBe(400);
      const json2 = await res2.json();
      expect(json2.error.message).toContain("already-verified");
    });
  });

  describe("action: capability", () => {
    it("rejects capability issuance when proofToken is missing and present > 0", async () => {
      const response = await POST(request({ action: "capability", sha256: missingDigests[0] }));
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error.code).toBe("PREVERIFICATION_REQUIRED");
    });

    it("rejects capability issuance when proofToken contains incomplete verification", async () => {
      // Proof only has 8 of the 72 present objects
      const partialProof = issueVerificationProof(presentDigests.slice(0, 8), mockInventory, mockRuntime);
      const response = await POST(request({
        action: "capability",
        sha256: missingDigests[0],
        proofToken: partialProof,
      }));
      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error.code).toBe("PREVERIFICATION_REQUIRED");
    });

    it("issues capability when complete proof of all 72 present objects is provided", async () => {
      const completeProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
      const response = await POST(request({
        action: "capability",
        sha256: missingDigests[0],
        proofToken: completeProof,
      }));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.sha256).toBe(missingDigests[0]);
      expect(json.capabilityUrl).toBe("https://blob.vercel-storage.com/capability");
    });

    it("rejects capability issuance for an already present object with HTTP 409", async () => {
      const completeProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
      const response = await POST(request({
        action: "capability",
        sha256: presentDigests[0],
        proofToken: completeProof,
      }));
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("ARTWORK_ALREADY_PRESENT");
    });

    it("rejects capability issuance for an unapproved digest", async () => {
      const completeProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
      const response = await POST(request({
        action: "capability",
        sha256: "f".repeat(64),
        proofToken: completeProof,
      }));
      expect(response.status).toBe(400);
    });

    it("rejects client-provided storage keys", async () => {
      const response = await POST(request({
        action: "capability",
        sha256: missingDigests[0],
        storageKey: "artwork/sha256/arbitrary.png",
      }));
      expect(response.status).toBe(400);
    });
  });

  describe("action: inventory", () => {
    it("fails final inventory unless all 83 exact objects are present", async () => {
      transfer.reconcilePreviewArtworkInventory.mockResolvedValue({
        expected: 83,
        present: 82,
        missing: 1,
        unexpected: 0,
      });
      const response = await POST(request({ action: "inventory" }));
      expect(response.status).toBe(409);
    });

    it("succeeds when exactly 83 objects are present and 0 missing or unexpected", async () => {
      transfer.reconcilePreviewArtworkInventory.mockResolvedValue({
        expected: 83,
        present: 83,
        missing: 0,
        unexpected: 0,
      });
      const response = await POST(request({ action: "inventory" }));
      expect(response.status).toBe(200);
    });
  });

  it("maps a native Blob 403 to a safe hard-stop code", async () => {
    const completeProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
    transfer.issuePreviewArtworkUploadCapability.mockRejectedValue(new Error("upstream request failed: 403 Forbidden"));
    const response = await POST(request({
      action: "capability",
      sha256: missingDigests[0],
      proofToken: completeProof,
    }));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BLOB_AUTH_FORBIDDEN", message: "Preview Blob authorization was forbidden." },
    });
  });
});

function request(body: Record<string, unknown>): Request {
  return new Request("https://preview.local/api/admin/preview-artwork-transfer", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-preview-artwork-transfer-secret": "secret",
    },
    body: JSON.stringify(body),
  });
}
