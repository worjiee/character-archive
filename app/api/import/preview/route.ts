import { requireOwnerApiSession } from "@/src/lib/auth";
import {
  developmentImportUnavailableResponse,
  isDevelopmentFixtureEnabled,
} from "@/src/lib/importers/development";
import { getSourceUrl, importErrorResponse, readJson } from "../errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireOwnerApiSession(request);
  if (unauthorized) return unauthorized;
  if (!isDevelopmentFixtureEnabled()) return developmentImportUnavailableResponse();
  try {
    const sourceUrl = getSourceUrl(await readJson(request));
    const { previewDevelopmentCharacter } = await import("@/src/lib/importers/workflow");
    return Response.json({ preview: await previewDevelopmentCharacter(sourceUrl) });
  } catch (error) {
    return importErrorResponse(error);
  }
}
