import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  CharacterCartCheckoutSizeError,
  CharacterCartCheckoutValidationError,
  CHARACTER_CART_CHECKOUT_FILENAME,
  createCharacterCartCheckoutZip,
  getCharacterCartCheckoutItems,
  parseCharacterCartCheckoutBody,
} from "@/src/lib/characters/cart-checkout";

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const selectedIds = parseCharacterCartCheckoutBody(await readJsonBody(request));
    const items = await getCharacterCartCheckoutItems(session.principal, selectedIds);
    if (items.length !== selectedIds.length) {
      return Response.json(
        { error: { code: "CART_CHANGED", message: "One or more selected characters are no longer available in your Cart." } },
        { status: 409 },
      );
    }
    const checkout = createCharacterCartCheckoutZip(items, session.principal);
    const body = checkout.bytes.buffer.slice(
      checkout.bytes.byteOffset,
      checkout.bytes.byteOffset + checkout.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${CHARACTER_CART_CHECKOUT_FILENAME}"`,
        "Content-Length": String(checkout.bytes.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CharacterCartCheckoutValidationError) {
      return Response.json(
        { error: { code: "INVALID_REQUEST", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof CharacterCartCheckoutSizeError) {
      return Response.json(
        { error: { code: "CHECKOUT_TOO_LARGE", message: error.message } },
        { status: 413 },
      );
    }
    console.error("Cart ZIP checkout failed", error);
    return Response.json(
      { error: { code: "CHECKOUT_FAILED", message: "The ZIP checkout could not be prepared." } },
      { status: 500 },
    );
  }
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new CharacterCartCheckoutValidationError("Request body must be valid JSON.");
  }
}
