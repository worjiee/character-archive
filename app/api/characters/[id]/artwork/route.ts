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
  const { id } = await context.params;
  const url = new URL(request.url);
  const requestedSha = url.searchParams.get("v") || url.searchParams.get("sha");

  const record = await prisma.character.findFirst({
    where: { AND: [{ id }, visibleCharacterWhere(session.principal)] },
    select: {
      artwork: { select: { sha256: true, mediaType: true, byteLength: true, storageKey: true } },
    },
  });
  if (!record) return new Response(null, { status: 404 });

  let artworkToServe = record.artwork;
  if (requestedSha && requestedSha !== record.artwork?.sha256) {
    const historical = await prisma.characterVersion.findFirst({
      where: { characterId: id, artworkSha256: requestedSha },
      include: { artwork: { select: { sha256: true, mediaType: true, byteLength: true, storageKey: true } } },
    });
    if (historical?.artwork) {
      artworkToServe = historical.artwork;
    }
  }

  if (!artworkToServe || artworkToServe.mediaType !== "image/png") return new Response(null, { status: 404 });
  try {
    const bytes = await getArtworkObjectStore().readFinal(artworkToServe.storageKey);
    if (
      !bytes || bytes.byteLength !== artworkToServe.byteLength
      || createHash("sha256").update(bytes).digest("hex") !== artworkToServe.sha256
    ) return new Response(null, { status: 404 });
    return artworkResponse(bytes, { etag: artworkToServe.sha256, request });
  } catch (error) {
    console.error("Character artwork read failed", error);
    return new Response(null, { status: 404 });
  }
}
