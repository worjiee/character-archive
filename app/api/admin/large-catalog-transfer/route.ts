import { cookies } from "next/headers";
import {
  assertOperatorAuthorized,
  assertPreviewEnvironment,
  issueUploadCapability,
  issueVerificationProof,
  LargeCatalogTransferError,
  reconcileLiveInventory,
  verifyBoundedBytesBatch,
  verifyUploadedObjectHead,
} from "@/src/lib/artwork/large-catalog-transfer";
import { authenticateUserSession } from "@/src/lib/auth/session";
import { USER_SESSION_COOKIE } from "@/src/lib/auth/session-token";
import {
  APPROVED_271_BY_DIGEST,
  BASELINE_83_DIGESTS,
} from "@/src/lib/artwork/large-catalog-manifest";

const MAX_CONTROL_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  try {
    assertPreviewEnvironment();

    // Authorization check: either operator secret header or authenticated admin user session
    const operatorSecret = request.headers.get("x-preview-operator-secret");
    const configuredSecretHash = process.env.PREVIEW_LARGE_CATALOG_OPERATOR_SECRET_HASH;

    let authorized = false;
    if (operatorSecret && configuredSecretHash) {
      assertOperatorAuthorized(operatorSecret, configuredSecretHash);
      authorized = true;
    } else {
      const cookieStore = await cookies();
      const sessionToken = cookieStore.get(USER_SESSION_COOKIE)?.value;
      const session = await authenticateUserSession(sessionToken);
      if (session && session.principal.role === "ADMIN") {
        authorized = true;
      }
    }

    if (!authorized) {
      throw new LargeCatalogTransferError(
        "UNAUTHORIZED",
        "Administrator session or valid operator secret is required.",
        401,
      );
    }

    const body = await readControlBody(request);

    if (body.action === "status") {
      const inventory = await reconcileLiveInventory();
      return noStore({ inventory });
    }

    if (body.action === "capability") {
      if (typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256)) {
        throw new LargeCatalogTransferError("INVALID_REQUEST", "A valid 64-character SHA-256 digest is required.", 400);
      }
      if (body.dryRun === true) {
        if (!APPROVED_271_BY_DIGEST.has(body.sha256)) {
          throw new LargeCatalogTransferError("UNAPPROVED_DIGEST", "Digest is not in approved manifest.", 403);
        }
        return noStore({ sha256: body.sha256, dryRun: true, validated: true });
      }
      const capability = await issueUploadCapability(body.sha256);
      return noStore({ capability });
    }

    if (body.action === "verify") {
      if (typeof body.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(body.sha256)) {
        throw new LargeCatalogTransferError("INVALID_REQUEST", "A valid 64-character SHA-256 digest is required.", 400);
      }
      const result = await verifyUploadedObjectHead(body.sha256);
      return noStore(result);
    }

    if (body.action === "verify-bytes-batch") {
      if (!Array.isArray(body.digests) || body.digests.length === 0) {
        throw new LargeCatalogTransferError("INVALID_REQUEST", "Digests array is required for batch byte-verification.", 400);
      }
      const result = await verifyBoundedBytesBatch(body.digests as string[]);
      return noStore(result);
    }

    if (body.action === "reconcile") {
      const inventory = await reconcileLiveInventory();
      const operatorSecretHash = configuredSecretHash || "session-auth-fallback-key";
      const proofToken = issueVerificationProof(
        [...BASELINE_83_DIGESTS, ...APPROVED_271_BY_DIGEST.keys()],
        inventory,
        operatorSecretHash,
      );
      return noStore({ inventory, proofToken });
    }

    throw new LargeCatalogTransferError("INVALID_REQUEST", `Unrecognized transfer action: ${body.action}`, 400);
  } catch (error) {
    if (error instanceof LargeCatalogTransferError) {
      return noStore({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error("Large-catalog transfer route error:", error);
    return noStore({ error: { code: "TRANSFER_ERROR", message: "An unexpected transfer error occurred." } }, 500);
  }
}

async function readControlBody(request: Request): Promise<{
  action: string;
  sha256?: unknown;
  digests?: unknown;
  dryRun?: unknown;
}> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new LargeCatalogTransferError("INVALID_REQUEST", "Content-Type must be application/json.", 400);
  }
  const text = await request.text();
  if (text.length === 0 || Buffer.byteLength(text, "utf8") > MAX_CONTROL_BODY_BYTES) {
    throw new LargeCatalogTransferError("INVALID_REQUEST", "Request body exceeds bounds.", 400);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LargeCatalogTransferError("INVALID_REQUEST", "Invalid JSON payload.", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LargeCatalogTransferError("INVALID_REQUEST", "Invalid JSON object.", 400);
  }
  const record = parsed as Record<string, unknown>;
  return {
    action: typeof record.action === "string" ? record.action : "",
    sha256: record.sha256,
    digests: record.digests,
    dryRun: record.dryRun,
  };
}

function noStore(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
