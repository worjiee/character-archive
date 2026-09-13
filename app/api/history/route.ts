import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  clearCharacterHistory,
  getPaginatedHistory,
} from "@/src/lib/history/service";
import { ownerErrorResponse } from "../owner-errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");

    const page = pageParam ? parseInt(pageParam, 10) : 1;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 24;

    const result = await getPaginatedHistory(
      session.principal,
      isNaN(page) ? 1 : page,
      isNaN(pageSize) ? 24 : pageSize,
    );

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    const result = await clearCharacterHistory(session.principal);
    return Response.json({ success: true, count: result.count });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}