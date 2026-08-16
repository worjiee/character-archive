import { saveDevelopmentCharacter } from "@/src/lib/importers/workflow";
import { getSourceUrl, importErrorResponse, readJson } from "../errors";

export async function POST(request: Request): Promise<Response> {
  try {
    const sourceUrl = getSourceUrl(await readJson(request));
    return Response.json({ result: await saveDevelopmentCharacter(sourceUrl) });
  } catch (error) {
    return importErrorResponse(error, true);
  }
}
