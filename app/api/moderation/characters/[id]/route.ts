import { moderateQuarantinedCharacter } from "@/src/lib/moderation";
import { requireOwnerApiSession } from "@/src/lib/auth";
import { moderationErrorResponse, readModerationJson, requireRouteId } from "../../errors";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireOwnerApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await context.params;
    const body = await readModerationJson(request);
    await moderateQuarantinedCharacter(requireRouteId(id), body.action);
    return Response.json({ success: true });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
