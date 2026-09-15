import { requireAdminApiSession } from "@/src/lib/auth";
import { validateBackupManifest } from "@/src/lib/backup/service";

const MAX_MANIFEST_BODY_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BODY_BYTES) {
    return Response.json(
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: "Manifest payload exceeds maximum allowed size (5MB).",
        },
      },
      { status: 413 },
    );
  }

  try {
    const body = await request.json();
    const result = validateBackupManifest(body);
    const response = Response.json({ result });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return Response.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "The request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  }
}
