import { deleteBlockRule, setBlockRuleEnabled } from "@/src/lib/moderation";
import { moderationErrorResponse, readModerationJson, requireRouteId } from "../../errors";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    const body = await readModerationJson(request);
    return Response.json(await setBlockRuleEnabled(requireRouteId(id), body.enabled));
  } catch (error) {
    return moderationErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const { id } = await context.params;
    await deleteBlockRule(requireRouteId(id));
    return new Response(null, { status: 204 });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
