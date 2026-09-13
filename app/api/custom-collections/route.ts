import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  createUserCollection,
  listUserCollections,
} from "@/src/lib/collections/custom-collections";
import { ownerErrorResponse, readOwnerJson } from "../owner-errors";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const collections = await listUserCollections(session.principal);
    return Response.json(
      { collections },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return ownerErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });

    const body = await readOwnerJson(request);
    const collection = await createUserCollection(session.principal, {
      name: String(body.name ?? ""),
      description: body.description !== undefined ? String(body.description) : undefined,
    });

    return Response.json({ collection }, { status: 201 });
  } catch (error) {
    return ownerErrorResponse(error);
  }
}
