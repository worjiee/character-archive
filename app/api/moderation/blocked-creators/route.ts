import { createBlockedCreatorAndRecheck } from "@/src/lib/moderation";
import { moderationErrorResponse, readModerationJson } from "../errors";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readModerationJson(request);
    return Response.json(await createBlockedCreatorAndRecheck({
      platform: body.platform,
      externalCreatorId: body.externalCreatorId,
      creatorName: body.creatorName,
      reason: body.reason,
    }), { status: 201 });
  } catch (error) {
    return moderationErrorResponse(error);
  }
}
