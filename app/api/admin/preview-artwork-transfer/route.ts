import { getAuthenticatedUserApiSession, requireAdminApiSession } from "@/src/lib/auth";
import {
  ARTWORK_SHA256_PATTERN,
  issuePreviewArtworkUploadCapability,
  issueVerificationProof,
  loadApprovedPreviewArtwork,
  loadPreviewArtworkManifest,
  PREVIEW_ARTWORK_VERIFY_BATCH_MAX_SIZE,
  PreviewArtworkTransferError,
  readPreviewArtworkTransferRuntime,
  reconcilePreviewArtworkInventory,
  verifyPreviewArtworkObject,
  verifyPreviewArtworkOperatorSecret,
  verifyVerificationProof,
  verifyVerificationProofForAdvancement,
} from "@/src/lib/artwork/preview-transfer";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CONTROL_BODY_BYTES = 32 * 1024;

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const transferRuntime = readPreviewArtworkTransferRuntime(request);
    const operatorSecret = request.headers.get("x-preview-artwork-transfer-secret");
    if (!operatorSecret) {
      return noStore({ error: { code: "OPERATOR_AUTH_REQUIRED", message: "Operator authorization required." } }, 403);
    }
    const authorized = await verifyPreviewArtworkOperatorSecret(operatorSecret, transferRuntime);
    if (!authorized) {
      return noStore({ error: { code: "OPERATOR_AUTH_REQUIRED", message: "Operator authorization failed." } }, 403);
    }
    const session = await getAuthenticatedUserApiSession(request);
    if (!session || session.principal.role !== "ADMIN") {
      return noStore({ error: { code: "OPERATOR_AUTH_REQUIRED", message: "Operator authorization failed." } }, 403);
    }
    const body = await readControlBody(request);

    if (body.action === "preflight") {
      const manifest = await loadPreviewArtworkManifest(prisma, {
        sessionId: session.sessionId,
        userId: session.principal.userId,
      });
      const inventory = await reconcilePreviewArtworkInventory(manifest, transferRuntime);
      if (inventory.unexpected !== 0) {
        throw new PreviewArtworkTransferError(
          "PREVIEW_INVARIANT_MISMATCH",
          "Unexpected objects detected in artwork storage.",
          409,
        );
      }
      return noStore({
        manifest,
        inventory: {
          expected: inventory.expected,
          present: inventory.present,
          missing: inventory.missing,
          unexpected: inventory.unexpected,
        },
        presentDigests: inventory.presentDigests,
        missingDigests: inventory.missingDigests,
      });
    }

    if (body.action === "verify-batch") {
      if (!Array.isArray(body.digests) || body.digests.length === 0 || body.digests.length > PREVIEW_ARTWORK_VERIFY_BATCH_MAX_SIZE) {
        throw new PreviewArtworkTransferError(
          "INVALID_TRANSFER_REQUEST",
          `Batch size must be between 1 and ${PREVIEW_ARTWORK_VERIFY_BATCH_MAX_SIZE} objects.`,
          400,
        );
      }

      const manifest = await loadPreviewArtworkManifest(prisma, {
        sessionId: session.sessionId,
        userId: session.principal.userId,
      });
      const inventory = await reconcilePreviewArtworkInventory(manifest, transferRuntime);
      if (inventory.unexpected !== 0) {
        throw new PreviewArtworkTransferError(
          "PREVIEW_INVARIANT_MISMATCH",
          "Unexpected objects detected in artwork storage.",
          409,
        );
      }

      let verifiedSet = new Set<string>();
      if (body.proofToken !== undefined) {
        const previousProof = verifyVerificationProof(body.proofToken as string, inventory, transferRuntime);
        verifiedSet = new Set(previousProof.verifiedDigests);
      }

      const batchDigests = body.digests as string[];
      for (const digest of batchDigests) {
        if (typeof digest !== "string" || !ARTWORK_SHA256_PATTERN.test(digest)) {
          throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "Invalid SHA-256 digest format.", 400);
        }
        if (verifiedSet.has(digest)) {
          throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "Batch contains already-verified digest.", 400);
        }
        if (!inventory.presentDigests.includes(digest)) {
          throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "Digest is not present in storage.", 400);
        }
        const item = await loadApprovedPreviewArtwork(prisma, digest);
        await verifyPreviewArtworkObject(item, transferRuntime);
        verifiedSet.add(digest);
      }

      const allVerified = Array.from(verifiedSet).sort();
      const updatedProofToken = issueVerificationProof(allVerified, inventory, transferRuntime);

      return noStore({
        verifiedDigests: allVerified,
        proofToken: updatedProofToken,
        batchCount: batchDigests.length,
        totalVerified: allVerified.length,
      });
    }

    if (body.action === "capability") {
      if (typeof body.sha256 !== "string" || !ARTWORK_SHA256_PATTERN.test(body.sha256)) {
        throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
      }
      const sha256 = body.sha256;
      const manifest = await loadPreviewArtworkManifest(prisma, {
        sessionId: session.sessionId,
        userId: session.principal.userId,
      });
      const inventory = await reconcilePreviewArtworkInventory(manifest, transferRuntime);
      if (inventory.unexpected !== 0) {
        throw new PreviewArtworkTransferError(
          "PREVIEW_INVARIANT_MISMATCH",
          "Unexpected objects detected in artwork storage.",
          409,
        );
      }
      if (inventory.presentDigests.includes(sha256)) {
        throw new PreviewArtworkTransferError(
          "ARTWORK_ALREADY_PRESENT",
          "The requested artwork object is already present and verified in storage.",
          409,
        );
      }
      if (!inventory.missingDigests.includes(sha256)) {
        throw new PreviewArtworkTransferError(
          "INVALID_TRANSFER_REQUEST",
          "The requested artwork object is not proven missing from inventory.",
          400,
        );
      }

      if (inventory.present > 0) {
        if (!body.proofToken) {
          throw new PreviewArtworkTransferError(
            "PREVERIFICATION_REQUIRED",
            "Capability issuance requires prior cryptographic verification proof of all currently present artwork objects.",
            403,
          );
        }
        const proof = verifyVerificationProof(body.proofToken as string, inventory, transferRuntime);
        const proofSet = new Set(proof.verifiedDigests);
        const allPresentVerified = inventory.presentDigests.every((d) => proofSet.has(d));
        if (!allPresentVerified || proof.verifiedDigests.length < inventory.present) {
          throw new PreviewArtworkTransferError(
            "PREVERIFICATION_REQUIRED",
            "Capability issuance requires all currently present artwork objects to be verified in proof.",
            403,
          );
        }
      }

      const item = await loadApprovedPreviewArtwork(prisma, sha256);
      if (body.dryRun === true) {
        return noStore({ sha256: item.sha256, dryRun: true, validated: true });
      }
      const capabilityUrl = await issuePreviewArtworkUploadCapability(item, transferRuntime);
      return noStore({ sha256: item.sha256, capabilityUrl, expiresInSeconds: 300 });
    }

    if (body.action === "verify") {
      if (typeof body.sha256 !== "string" || !ARTWORK_SHA256_PATTERN.test(body.sha256)) {
        throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
      }
      const item = await loadApprovedPreviewArtwork(prisma, body.sha256);
      await verifyPreviewArtworkObject(item, transferRuntime);

      if (body.proofToken !== undefined) {
        const manifest = await loadPreviewArtworkManifest(prisma, {
          sessionId: session.sessionId,
          userId: session.principal.userId,
        });
        const inventory = await reconcilePreviewArtworkInventory(manifest, transferRuntime);
        const previousProof = verifyVerificationProofForAdvancement(
          body.proofToken,
          item.sha256,
          inventory,
          transferRuntime,
        );
        const updatedVerified = Array.from(new Set([...previousProof.verifiedDigests, item.sha256])).sort();
        const updatedProofToken = issueVerificationProof(updatedVerified, inventory, transferRuntime);
        return noStore({ sha256: item.sha256, verified: true, proofToken: updatedProofToken });
      }

      return noStore({ sha256: item.sha256, verified: true });
    }

    if (body.action === "inventory") {
      const manifest = await loadPreviewArtworkManifest(prisma, {
        sessionId: session.sessionId,
        userId: session.principal.userId,
      });
      const inventory = await reconcilePreviewArtworkInventory(manifest, transferRuntime);
      if (
        inventory.expected !== 83 ||
        inventory.present !== 83 ||
        inventory.missing !== 0 ||
        inventory.unexpected !== 0
      ) {
        throw new PreviewArtworkTransferError(
          "ARTWORK_INVENTORY_MISMATCH",
          "Preview artwork inventory does not match the approved manifest.",
          409,
        );
      }
      return noStore({ inventory });
    }

    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  } catch (error) {
    if (
      error instanceof PreviewArtworkTransferError ||
      (error instanceof Error && error.name === "PreviewArtworkTransferError" && typeof (error as unknown as Record<string, unknown>).status === "number")
    ) {
      const e = error as PreviewArtworkTransferError;
      return noStore({ error: { code: e.code, message: e.message } }, e.status);
    }
    if (error instanceof Error && /\b403 Forbidden\b/u.test(error.message)) {
      console.error("Preview artwork transfer Blob authorization was forbidden.");
      return noStore({ error: { code: "BLOB_AUTH_FORBIDDEN", message: "Preview Blob authorization was forbidden." } }, 502);
    }
    console.error("Preview artwork transfer failed.");
    return noStore({ error: { code: "TRANSFER_FAILED", message: "Preview artwork transfer failed." } }, 500);
  }
}

async function readControlBody(request: Request): Promise<{
  action: string;
  sha256?: unknown;
  digests?: unknown;
  proofToken?: unknown;
  dryRun?: unknown;
}> {
  if (request.method !== "POST") {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  const rawContentLength = request.headers.get("content-length");
  if (rawContentLength !== null) {
    const contentLength = Number(rawContentLength);
    if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_CONTROL_BODY_BYTES) {
      throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
    }
  }
  const text = await request.text();
  if (text.length === 0 || Buffer.byteLength(text, "utf8") > MAX_CONTROL_BODY_BYTES) {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  const record = value as Record<string, unknown>;
  const allowed = record.action === "capability"
    ? ["action", "sha256", "proofToken", "dryRun"]
    : record.action === "verify-batch"
    ? ["action", "digests", "proofToken"]
    : record.action === "verify"
    ? ["action", "sha256", "proofToken"]
    : ["action"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  return {
    action: typeof record.action === "string" ? record.action : "",
    sha256: record.sha256,
    digests: record.digests,
    proofToken: record.proofToken,
    dryRun: record.dryRun,
  };
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
