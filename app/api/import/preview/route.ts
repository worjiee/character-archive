import { requireOwnerApiSession } from "@/src/lib/auth";
import {
  developmentImportUnavailableResponse,
  isDevelopmentFixtureEnabled,
} from "@/src/lib/importers/development";
import {
  getImportMethod,
  getSourceJson,
  getSourceUrl,
  importErrorResponse,
  readJson,
} from "../errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireOwnerApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const body = await readJson(request);
    const sourceUrl = getSourceUrl(body);
    if (getImportMethod(body) === "manual-json") {
      const { previewManualCharacter } = await import("@/src/lib/importers/workflow");
      return Response.json({ preview: await previewManualCharacter(sourceUrl, getSourceJson(body)) });
    }
    if (!isDevelopmentFixtureEnabled()) return developmentImportUnavailableResponse();
    const { previewDevelopmentCharacter } = await import("@/src/lib/importers/workflow");
    return Response.json({ preview: await previewDevelopmentCharacter(sourceUrl) });
  } catch (error) {
    return importErrorResponse(error);
  }
}
