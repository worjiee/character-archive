import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  FavoriteCreatorValidationError,
  listFavoriteCreators,
  parseFavoriteCreatorIdentity,
  setManualFavoriteCreator,
} from "@/src/lib/favorite-creators";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit == null ? undefined : Number(rawLimit);
    if (rawLimit != null && (!/^\d+$/u.test(rawLimit) || !Number.isSafeInteger(limit))) {
      throw new FavoriteCreatorValidationError("The limit is invalid.");
    }
    return Response.json(
      await listFavoriteCreators(session.principal.userId, {
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return favoriteCreatorError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json() as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new FavoriteCreatorValidationError("A request body is required.");
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["platform", "identityKind", "identityValue", "present"].includes(key))) {
      throw new FavoriteCreatorValidationError("The request contains unsupported fields.");
    }
    if (typeof record.present !== "boolean") {
      throw new FavoriteCreatorValidationError("present must be a boolean.");
    }
    const identity = parseFavoriteCreatorIdentity(record);
    return Response.json({
      identity,
      ...await setManualFavoriteCreator(session.principal.userId, identity, record.present),
    });
  } catch (error) {
    return favoriteCreatorError(error);
  }
}

function favoriteCreatorError(error: unknown): Response {
  if (error instanceof FavoriteCreatorValidationError) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ error: "Unable to update Favorite Creators." }, { status: 500 });
}
