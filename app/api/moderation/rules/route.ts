import { createBlockRuleAndRecheck } from "@/src/lib/moderation";
import { moderationErrorResponse, readModerationJson } from "../errors";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readModerationJson(request);
    return Response.json(await createBlockRuleAndRecheck({ type: body.type, value: body.value }), { status: 201 });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
