import { prisma } from "@/lib/prisma";
import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  createFallbackReviewPreview,
  fallbackReviewStore,
} from "@/src/lib/importers/fallback-review";
import { importErrorResponse, readJson } from "../../../errors";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Authentication required." } }, { status: 401 });
    return Response.json(fallbackReviewStore.detail(session.sessionId, (await context.params).id));
  } catch (error) {
    return importErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Authentication required." } }, { status: 401 });
    const created = await createFallbackReviewPreview(
      session.sessionId,
      (await context.params).id,
      await readJson(request),
      { client: prisma },
    );
    return Response.json(created, { status: 201 });
  } catch (error) {
    return importErrorResponse(error);
  }
}
