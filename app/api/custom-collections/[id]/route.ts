import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  deleteUserCollection,
  getUserCollection,
  updateUserCollection,
} from "@/src/lib/collections/custom-collections";
import { ownerErrorResponse, readOwnerJson } from "../../owner-errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { id } = await context.params;
    const collection = await getUserCollection(session.principal, id);
    return Response.json({ collection }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { id } = await context.params;
    const body = await readOwnerJson(request);
    const collection = await updateUserCollection(session.principal, id, {
      name: body.name !== undefined ? String(body.name) : undefined,
      description: body.description !== undefined ? String(body.description) : undefined,
    });

    return Response.json({ collection });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const { id } = await context.params;
    const result = await deleteUserCollection(session.principal, id);
    return Response.json(result);
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
