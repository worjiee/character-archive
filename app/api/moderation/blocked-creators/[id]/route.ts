import { deleteBlockedCreator, setBlockedCreatorEnabled } from "@/src/lib/moderation";
import { requireAdminApiSession } from "@/src/lib/auth";
import { moderationErrorResponse, readModerationJson, requireRouteId } from "../../errors";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const body = await readModerationJson(request);
    return Response.json(await setBlockedCreatorEnabled(requireRouteId(id), body.enabled));
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    await deleteBlockedCreator(requireRouteId(id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
