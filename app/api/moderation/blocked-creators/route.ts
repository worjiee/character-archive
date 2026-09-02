import { createBlockedCreatorAndRecheck } from "@/src/lib/moderation";
import { requireAdminApiSession } from "@/src/lib/auth";
import { moderationErrorResponse, readModerationJson } from "../errors";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
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
