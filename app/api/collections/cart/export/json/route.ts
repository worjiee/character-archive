import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  CHARACTER_CART_EXPORT_FILENAME,
  getCharacterCartExport,
} from "@/src/lib/characters/cart-export";
import {
  CharacterCollectionValidationError,
  assertCharacterCollectionInputKeys,
  parseCharacterIds,
} from "@/src/lib/characters/collections";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const searchParams = new URL(request.url).searchParams;
    assertCharacterCollectionInputKeys(Object.fromEntries(searchParams), ["characterId"]);
    const requestedIds = searchParams.getAll("characterId");
    const selectedIds = requestedIds.length > 0 ? parseCharacterIds(requestedIds) : undefined;
    const cartExport = await getCharacterCartExport(session.principal, selectedIds);
    if (cartExport.characters.length === 0) {
      return Response.json(
        { error: { code: "EMPTY_CART", message: "Cart is empty." } },
        { status: 409 },
      );
    }
    if (selectedIds && cartExport.characters.length !== selectedIds.length) {
      return Response.json(
        { error: { code: "CART_CHANGED", message: "One or more selected characters are no longer in Cart." } },
        { status: 409 },
      );
    }

    return new Response(`${JSON.stringify(cartExport, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${CHARACTER_CART_EXPORT_FILENAME}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CharacterCollectionValidationError) {
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: error.message } },
        { status: 400 },
      );
    }
    console.error("Cart JSON export failed", error);
    return Response.json(
      { error: { code: "EXPORT_FAILED", message: "The Cart export could not be prepared." } },
      { status: 500 },
    );
  }
}
