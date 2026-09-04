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

import { issueVerificationProof, verifyVerificationProof } from "../../../../src/lib/artwork/preview-transfer";
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

    it("supports dryRun capability validation without issuing presigned upload url", async () => {
      const completeProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
      const response = await POST(request({
        action: "capability",
        sha256: missingDigests[0],
        proofToken: completeProof,
        dryRun: true,
      }));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({
        sha256: missingDigests[0],
        dryRun: true,
        validated: true,
      });
      expect(transfer.issuePreviewArtworkUploadCapability).not.toHaveBeenCalled();
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

  describe("action: verify and proof advancement", () => {
    it("verifies object without proofToken and returns verified: true", async () => {
      const response = await POST(request({
        action: "verify",
        sha256: presentDigests[0],
      }));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ sha256: presentDigests[0], verified: true });
    });

    it("advances proofToken when verifying newly uploaded object in monotonic N -> N+1 transition", async () => {
      const initialProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
      const nextDigest = missingDigests[0];

      // Mutate storage state to reflect the committed upload of nextDigest: 73 present, 10 missing
      const advancedInventory = {
        expected: 83,
        present: 73,
        missing: 10,
        unexpected: 0,
        presentDigests: [...presentDigests, nextDigest],
        missingDigests: missingDigests.slice(1),
      };
      transfer.reconcilePreviewArtworkInventory.mockResolvedValue(advancedInventory);

      const response = await POST(request({
        action: "verify",
        sha256: nextDigest,
        proofToken: initialProof,
      }));
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.verified).toBe(true);
      expect(json.sha256).toBe(nextDigest);
      expect(typeof json.proofToken).toBe("string");

      // Verify the returned proofToken is bound to the advanced inventory
      const payload = verifyVerificationProof(json.proofToken, advancedInventory, mockRuntime);
      expect(payload.presentCount).toBe(73);
      expect(payload.missingCount).toBe(10);
      expect(payload.verifiedDigests).toEqual([...presentDigests, nextDigest].sort());
    });

    it("rejects verification with stale proofToken if storage mutated unexpectedly", async () => {
      const initialProof = issueVerificationProof(presentDigests, mockInventory, mockRuntime);
      const nextDigest = missingDigests[0];

      // Storage mutated by 2 objects instead of 1
      const invalidMutation = {
        expected: 83,
        present: 74,
        missing: 9,
        unexpected: 0,
        presentDigests: [...presentDigests, nextDigest, missingDigests[1]],
        missingDigests: missingDigests.slice(2),
      };
      transfer.reconcilePreviewArtworkInventory.mockResolvedValue(invalidMutation);

      const response = await POST(request({
        action: "verify",
        sha256: nextDigest,
        proofToken: initialProof,
      }));
      expect(response.status).toBe(409);
      const json = await response.json();
      expect(json.error.code).toBe("INVENTORY_MUTATED");
    });
  });

  describe("full 73 present / 10 missing -> 83/83 state transition protocol", () => {
    it("completes bounded verification of 73, upload/verification of remaining 10, and final inventory", async () => {
      // 1. Initial state: 73 present, 10 missing
      const start73Present = [...presentDigests, missingDigests[0]];
      const start10Missing = missingDigests.slice(1);
      let currentInventory = {
        expected: 83,
        present: 73,
        missing: 10,
        unexpected: 0,
        presentDigests: start73Present,
        missingDigests: start10Missing,
      };
      transfer.reconcilePreviewArtworkInventory.mockImplementation(async () => currentInventory);

      // 2. Preflight discovers 73 present, 10 missing
      const preflightRes = await POST(request({ action: "preflight" }));
      expect(preflightRes.status).toBe(200);
      const preflightJson = await preflightRes.json();
      expect(preflightJson.inventory.present).toBe(73);
      expect(preflightJson.inventory.missing).toBe(10);

      // 3. Bounded verification of all 73 objects in batches of <= 8 (9 batches of 8 + 1 batch of 1)
      let proofToken: string | undefined;
      for (let i = 0; i < start73Present.length; i += 8) {
        const batch = start73Present.slice(i, i + 8);
        const batchRes = await POST(request({
          action: "verify-batch",
          digests: batch,
          ...(proofToken ? { proofToken } : {}),
        }));
        expect(batchRes.status).toBe(200);
        const batchJson = await batchRes.json();
        proofToken = batchJson.proofToken;
      }
      expect(typeof proofToken).toBe("string");

      // 4. Sequential upload, verify, and proof advancement for all 10 remaining missing objects
      for (const missingDigest of start10Missing) {
        // Capability request requires current proofToken
        const capRes = await POST(request({
          action: "capability",
          sha256: missingDigest,
          proofToken,
        }));
        expect(capRes.status).toBe(200);

        // Simulate PUT: storage now has this object
        currentInventory = {
          expected: 83,
          present: currentInventory.present + 1,
          missing: currentInventory.missing - 1,
          unexpected: 0,
          presentDigests: [...currentInventory.presentDigests, missingDigest],
          missingDigests: currentInventory.missingDigests.filter((d) => d !== missingDigest),
        };

        // Verify request with proofToken advances the proof
        const verRes = await POST(request({
          action: "verify",
          sha256: missingDigest,
          proofToken,
        }));
        expect(verRes.status).toBe(200);
        const verJson = await verRes.json();
        expect(typeof verJson.proofToken).toBe("string");
        proofToken = verJson.proofToken;
      }

      // 5. All 83 objects are now present
      expect(currentInventory.present).toBe(83);
      expect(currentInventory.missing).toBe(0);

      // 6. Final inventory check succeeds
      const invRes = await POST(request({ action: "inventory" }));
      expect(invRes.status).toBe(200);
      const invJson = await invRes.json();
      expect(invJson.inventory.present).toBe(83);
      expect(invJson.inventory.missing).toBe(0);
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
