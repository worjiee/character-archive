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
  let detectedProvider: string | null = null;
  let resolvedSupportState: string | null = null;
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
    const support = defaultSourceOrchestrator.supportState(sourceUrl);
    detectedProvider = support.detectedProvider ?? null;
    resolvedSupportState = support.state;
    if (support.state !== "AVAILABLE") {
      const pendingDataCat = support.state === "RECOGNIZED_PENDING_CAPABILITY";
      return Response.json({
        detectedProvider: support.detectedProvider,
        supportState: support.state,
        error: {
          code: pendingDataCat ? "SOURCE_PENDING_CAPABILITY" : support.state === "RECOGNIZED_UNAVAILABLE" ? "SOURCE_UNAVAILABLE" : "UNSUPPORTED_SOURCE",
          message: pendingDataCat
            ? "DataCat importing is not available yet. You can upload the Character Card instead."
            : "This source isn't supported yet. You can upload the Character Card instead.",
        },
      }, { status: 422 });
    }
    const candidate = await defaultSourceOrchestrator.retrieveSingleCandidate(sourceUrl, {
      mode: "PUBLIC_ONLY",
    });
    const job = await createImportPreviewJob(
      session.sessionId,
      candidate,
      "automatic-url",
    );
    return Response.json({
      ...job,
      detectedProvider: support.detectedProvider,
      supportState: support.state,
    });
  } catch (error) {
    const response = importErrorResponse(error);
    if (!resolvedSupportState) return response;
    const body = await response.json() as Record<string, unknown>;
    return Response.json({ ...body, detectedProvider, supportState: resolvedSupportState }, { status: response.status });
  }
}
