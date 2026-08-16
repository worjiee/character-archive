import { saveDevelopmentCharacter } from "@/src/lib/importers/workflow";
import { requireOwnerApiSession } from "@/src/lib/auth";
import { getSourceUrl, importErrorResponse, readJson } from "../errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireOwnerApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const sourceUrl = getSourceUrl(await readJson(request));
    return Response.json({ result: await saveDevelopmentCharacter(sourceUrl) });
  } catch (error) {
    return importErrorResponse(error, true);
  }
}
