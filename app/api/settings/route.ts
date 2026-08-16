import { updateRepositorySettings } from "@/src/lib/settings";
import { requireOwnerApiSession } from "@/src/lib/auth";
import { ownerErrorResponse, readOwnerJson } from "../owner-errors";

export async function PATCH(request: Request): Promise<Response> {
  const unauthorized = await requireOwnerApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    return Response.json({ settings: await updateRepositorySettings(await readOwnerJson(request)) });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
