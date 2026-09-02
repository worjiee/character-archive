import { requireAdminApiSession } from "../../../../src/lib/auth";
import {
  defaultCredentialProvider,
  InvalidSourceCredentialError,
  SourceEncryptionKeyError,
} from "../../../../src/lib/importers/retrieval";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await request.json();
    if (!isRecord(body) || typeof body.token !== "string") {
      return Response.json(
        { error: { code: "INVALID_CREDENTIAL", message: "A Janitor bearer token is required." } },
        { status: 400 },
      );
    }

    let expiresAt: Date | null = null;
    if (typeof body.expiresAt === "string" && body.expiresAt.trim().length > 0) {
      const parsedDate = new Date(body.expiresAt.trim());
      if (Number.isNaN(parsedDate.getTime())) {
        return Response.json(
          { error: { code: "INVALID_EXPIRES_AT", message: "Invalid expiration date format." } },
          { status: 400 },
        );
      }
      expiresAt = parsedDate;
    }

    await defaultCredentialProvider.setCredential("JANITOR_AI", body.token, expiresAt);

    return Response.json({
      success: true,
      connected: true,
    });
  } catch (error) {
    if (error instanceof InvalidSourceCredentialError) {
      return Response.json(
        { error: { code: "INVALID_CREDENTIAL", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof SourceEncryptionKeyError) {
      return Response.json(
        { error: { code: "ENCRYPTION_UNCONFIGURED", message: "Source encryption is not configured." } },
        { status: 503 },
      );
    }

    // Never leak raw runtime errors (e.g. undefined delegates) or secrets to the browser
    return Response.json(
      { error: { code: "CONNECTION_FAILED", message: "Unable to save source connection." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    await defaultCredentialProvider.revokeCredential("JANITOR_AI");
    return Response.json({
      success: true,
      connected: false,
    });
  } catch {
    return Response.json(
      { error: { code: "DISCONNECT_FAILED", message: "Unable to disconnect source connection." } },
      { status: 500 },
    );
  }
}
