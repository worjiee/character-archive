import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import { characterExportFilename, getCharacterExport } from "@/src/lib/characters/export";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await context.params;
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return Response.json({ error: "Authentication required." }, { status: 401 });
    const characterExport = await getCharacterExport(id, session.principal);
    if (!characterExport) {
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Character not found." } },
        { status: 404 },
      );
    }

    const filename = characterExportFilename(characterExport.character.name);
    return new Response(`${JSON.stringify(characterExport, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Character JSON export failed", error);
    return Response.json(
      { error: { code: "EXPORT_FAILED", message: "The character export could not be prepared." } },
      { status: 500 },
    );
  }
}
