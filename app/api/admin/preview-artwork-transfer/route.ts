import { getAuthenticatedUserApiSession, requireAdminApiSession } from "@/src/lib/auth";
import {
  issuePreviewArtworkUploadCapability,
  loadApprovedPreviewArtwork,
  loadPreviewArtworkManifest,
  PreviewArtworkTransferError,
  readPreviewArtworkTransferRuntime,
  reconcilePreviewArtworkInventory,
  verifyPreviewArtworkObject,
  verifyPreviewArtworkOperatorSecret,
} from "@/src/lib/artwork/preview-transfer";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CONTROL_BODY_BYTES = 4 * 1024;

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const transferRuntime = readPreviewArtworkTransferRuntime(request);
    const operatorSecret = request.headers.get("x-preview-artwork-transfer-secret");
    if (!await verifyPreviewArtworkOperatorSecret(operatorSecret, transferRuntime)) {
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
      if (inventory.present > 0) {
        const manifestMap = new Map(manifest.map((item) => [item.sha256, item]));
        for (const sha256 of inventory.presentDigests) {
          const item = manifestMap.get(sha256);
          if (!item) {
            throw new PreviewArtworkTransferError(
              "PREVIEW_INVARIANT_MISMATCH",
              "Present object is not in approved manifest.",
              409,
            );
          }
          await verifyPreviewArtworkObject(item, transferRuntime);
        }
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

    if (body.action === "capability") {
      if (typeof body.sha256 !== "string") {
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
      const item = await loadApprovedPreviewArtwork(prisma, sha256);
      const capabilityUrl = await issuePreviewArtworkUploadCapability(item, transferRuntime);
      return noStore({ sha256: item.sha256, capabilityUrl, expiresInSeconds: 300 });
    }

    if (body.action === "verify") {
      if (typeof body.sha256 !== "string") {
        throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
      }
      const item = await loadApprovedPreviewArtwork(prisma, body.sha256);
      await verifyPreviewArtworkObject(item, transferRuntime);
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
    if (error instanceof PreviewArtworkTransferError) {
      return noStore({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof Error && /\b403 Forbidden\b/u.test(error.message)) {
      console.error("Preview artwork transfer Blob authorization was forbidden.");
      return noStore({ error: { code: "BLOB_AUTH_FORBIDDEN", message: "Preview Blob authorization was forbidden." } }, 502);
    }
    console.error("Preview artwork transfer failed.");
    return noStore({ error: { code: "TRANSFER_FAILED", message: "Preview artwork transfer failed." } }, 500);
  }
}

async function readControlBody(request: Request): Promise<{ action: string; sha256?: unknown }> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > MAX_CONTROL_BODY_BYTES) {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_CONTROL_BODY_BYTES) {
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
  const allowed = record.action === "capability" || record.action === "verify"
    ? ["action", "sha256"]
    : ["action"];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new PreviewArtworkTransferError("INVALID_TRANSFER_REQUEST", "The artwork transfer request is invalid.", 400);
  }
  return { action: typeof record.action === "string" ? record.action : "", sha256: record.sha256 };
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
