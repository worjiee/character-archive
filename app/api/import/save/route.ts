import { requireOwnerApiSession } from "@/src/lib/auth";
import {
  developmentImportUnavailableResponse,
  isDevelopmentFixtureEnabled,
} from "@/src/lib/importers/development";
import {
  getImportMethod,
  getLinkSelection,
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
    const { targetCharacterId } = getLinkSelection(body);
    if (getImportMethod(body) === "manual-json") {
      const { saveManualCharacter } = await import("@/src/lib/importers/workflow");
      return Response.json({
        result: await saveManualCharacter(sourceUrl, getSourceJson(body), {
          targetCharacterId,
        }),
      });
    }
    if (!isDevelopmentFixtureEnabled()) return developmentImportUnavailableResponse();
    const { saveDevelopmentCharacter } = await import("@/src/lib/importers/workflow");
    return Response.json({
      result: await saveDevelopmentCharacter(sourceUrl, {
        targetCharacterId,
      }),
    });
  } catch (error) {
    return importErrorResponse(error, true);
  }
}
