import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  getImportMethod,
  getSourceJson,
  getSourceUrl,
  importErrorResponse,
  readJson,
  ImportRequestError,
} from "../errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson(request);
    const method = getImportMethod(body);
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    if (method === "browser-bridge") {
      throw new ImportRequestError("INVALID_IMPORT_METHOD", "Bridge previews are loaded from their bridge job.");
    }
    const sourceUrl = getSourceUrl(body);
    const { createImportPreviewJob } = await import("../../../../src/lib/importers/preview-jobs");
    if (method === "manual-json") {
      const { normalizeManualJanitorCharacter } = await import("../../../../src/lib/importers/janitor");
      return Response.json(await createImportPreviewJob(
        session.sessionId,
        normalizeManualJanitorCharacter(sourceUrl, getSourceJson(body)),
        "manual-json",
      ));
    }
    const { defaultSourceOrchestrator } = await import("../../../../src/lib/importers/retrieval");
    const character = await defaultSourceOrchestrator.retrieveSingleCharacter(sourceUrl, {
      mode: "PUBLIC_ONLY",
    });
    return Response.json(await createImportPreviewJob(
      session.sessionId,
      character,
      "automatic-url",
    ));
  } catch (error) {
    return importErrorResponse(error);
  }
}
