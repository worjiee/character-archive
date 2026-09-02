import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  getImportMethod,
  getLinkSelection,
  getPreviewJobId,
  importErrorResponse,
  readJson,
} from "../errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson(request);
    getImportMethod(body);
    const { targetCharacterId } = getLinkSelection(body);
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (targetCharacterId && session.principal.role !== "ADMIN") {
      return Response.json({ error: "Administrator access required." }, { status: 403 });
    }
    const { saveImportPreviewJob } = await import("../../../../src/lib/importers/preview-jobs");
    return Response.json({
      result: await saveImportPreviewJob(
        session.sessionId,
        session.principal,
        getPreviewJobId(body),
        {
        targetCharacterId,
        },
      ),
    });
  } catch (error) {
    return importErrorResponse(error, true);
  }
}
