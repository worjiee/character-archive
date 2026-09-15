import { requireAdminApiSession } from "@/src/lib/auth";
import { getArchiveHealth } from "@/src/lib/backup/service";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const spotCheck = url.searchParams.get("spotCheck") === "true";
    const health = await getArchiveHealth({ spotCheckStorage: spotCheck });

    const response = Response.json({ health });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "ARCHIVE_HEALTH_CHECK_FAILED",
          message: error instanceof Error ? error.message : "Failed to compute archive health status.",
        },
      },
      { status: 500 },
    );
  }
}
