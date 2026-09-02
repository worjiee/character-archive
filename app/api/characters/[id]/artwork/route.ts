import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { artworkResponse, getArtworkObjectStore } from "@/src/lib/artwork/index";
import { getAuthenticatedUserApiSession, requireUserApiSession, visibleCharacterWhere } from "@/src/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  const session = await getAuthenticatedUserApiSession(request);
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
  const record = await prisma.character.findFirst({
    where: { AND: [{ id: (await context.params).id }, visibleCharacterWhere(session.principal)] },
    select: {
      artwork: { select: { sha256: true, mediaType: true, byteLength: true, storageKey: true } },
    },
  });
  if (!record?.artwork || record.artwork.mediaType !== "image/png") return new Response(null, { status: 404 });
  try {
    const bytes = await getArtworkObjectStore().readFinal(record.artwork.storageKey);
    if (
      !bytes || bytes.byteLength !== record.artwork.byteLength
      || createHash("sha256").update(bytes).digest("hex") !== record.artwork.sha256
    ) return new Response(null, { status: 404 });
    return artworkResponse(bytes, { etag: record.artwork.sha256, request });
  } catch (error) {
    console.error("Character artwork read failed", error);
    return new Response(null, { status: 404 });
  }
}
