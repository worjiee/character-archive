import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { getImportPreviewJob } from "@/src/lib/importers/preview-jobs";
import { importErrorResponse } from "../../errors";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    return Response.json(await getImportPreviewJob(session.sessionId, (await context.params).id));
  } catch (error) {
    return importErrorResponse(error, true);
  }
}
