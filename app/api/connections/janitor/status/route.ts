import { requireAdminApiSession } from "../../../../../src/lib/auth";
import { defaultCredentialProvider } from "../../../../../src/lib/importers/retrieval";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const status = await defaultCredentialProvider.getConnectionStatus("JANITOR_AI");
    return Response.json({
      connected: status.connected,
      platform: status.platform,
      expiresAt: status.expiresAt?.toISOString() ?? null,
      updatedAt: status.updatedAt?.toISOString() ?? null,
    });
  } catch {
    return Response.json(
      { error: { code: "STATUS_FAILED", message: "Unable to retrieve source connection status." } },
      { status: 500 },
    );
  }
}
