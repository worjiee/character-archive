import { updateRepositorySettings } from "@/src/lib/settings";
import { ownerErrorResponse, readOwnerJson } from "../owner-errors";

export async function PATCH(request: Request): Promise<Response> {
  try {
    return Response.json({ settings: await updateRepositorySettings(await readOwnerJson(request)) });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
