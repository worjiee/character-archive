import { createHash } from "node:crypto";
import { requireAdminApiSession } from "@/src/lib/auth";
import {
  SupabaseArtworkObjectStore,
  DEFAULT_SUPABASE_ARTWORK_BUCKET,
  readSupabaseCredentials,
} from "@/src/lib/artwork/supabase-store";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;
  return Response.json({
    status: "ready",
    bucket: DEFAULT_SUPABASE_ARTWORK_BUCKET,
    hasUrl: Boolean(process.env.DATABASE_SUPABASE_URL || process.env.NEXT_PUBLIC_DATABASE_SUPABASE_URL),
    hasServiceKey: Boolean(process.env.DATABASE_SUPABASE_SERVICE_ROLE_KEY || process.env.DATABASE_SUPABASE_SECRET_KEY),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireAdminApiSession(request);
  if (unauthorized) return unauthorized;

  const contentType = request.headers.get("content-type") || "";

  // 1. JSON control actions (e.g. inventory verification, spot check)
  if (contentType.includes("application/json")) {
    const body = await request.json().catch(() => null);
    if (!body || !body.action) {
      return Response.json({ error: "Missing action" }, { status: 400 });
    }

    if (body.action === "verify-inventory") {
      const rows = await prisma.$queryRaw<Array<{ name: string; size: bigint }>>`
        SELECT name, (metadata->>'size')::bigint as size 
        FROM storage.objects 
        WHERE bucket_id = ${DEFAULT_SUPABASE_ARTWORK_BUCKET}
      `;
      let totalBytes = BigInt(0);
      for (const r of rows) {
        totalBytes += BigInt(r.size);
      }
      return Response.json({
        count: rows.length,
        totalBytes: Number(totalBytes),
        objects: rows.map(r => ({ name: r.name, size: Number(r.size) })),
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (body.action === "spot-check") {
      const storageKey = String(body.storageKey || "");
      if (!storageKey) return Response.json({ error: "Missing storageKey" }, { status: 400 });
      const store = new SupabaseArtworkObjectStore();
      const bytes = await store.readFinal(storageKey);
      if (!bytes) return Response.json({ found: false }, { status: 404 });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return Response.json({
        found: true,
        byteLength: bytes.byteLength,
        sha256,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    if (body.action === "sign-upload") {
      const storageKey = String(body.storageKey || "");
      if (!storageKey) return Response.json({ error: "Missing storageKey" }, { status: 400 });
      const creds = readSupabaseCredentials();
      const res = await fetch(`${creds.url}/storage/v1/object/upload/sign/${DEFAULT_SUPABASE_ARTWORK_BUCKET}/${storageKey}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.serviceRoleKey}`,
          apikey: creds.serviceRoleKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ upsert: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return Response.json({ error: "Sign upload failed", status: res.status, details: data }, { status: res.status });
      }
      const rawUrl = String(data.url || "");
      const fullUrl = rawUrl.startsWith("http")
        ? rawUrl
        : `${creds.url}${rawUrl.startsWith("/storage/v1") ? "" : "/storage/v1"}${rawUrl}`;
      return Response.json({
        uploadUrl: fullUrl,
        token: data.token,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }

    return Response.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }

  // 2. Binary PNG Upload
  if (contentType.includes("image/png") || contentType.includes("application/octet-stream")) {
    const headerSha = request.headers.get("x-artwork-sha256")?.trim().toLowerCase();
    const width = Number(request.headers.get("x-artwork-width"));
    const height = Number(request.headers.get("x-artwork-height"));

    if (!headerSha || !/^[0-9a-f]{64}$/.test(headerSha)) {
      return Response.json({ error: "Valid x-artwork-sha256 header required." }, { status: 400 });
    }

    const arrayBuffer = await request.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const computedSha = createHash("sha256").update(bytes).digest("hex");

    if (computedSha !== headerSha) {
      return Response.json({
        error: "Payload hash mismatch",
        expected: headerSha,
        actual: computedSha,
      }, { status: 400 });
    }

    const metadata = {
      sha256: headerSha,
      mediaType: "image/png" as const,
      byteLength: bytes.byteLength,
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
    };

    const store = new SupabaseArtworkObjectStore();
    const result = await store.putVerifiedFinal(bytes, metadata);

    return Response.json({
      success: true,
      sha256: headerSha,
      storageKey: result.storageKey,
      byteLength: bytes.byteLength,
      created: result.created,
    }, { headers: { "Cache-Control": "private, no-store" } });
  }

  return Response.json({ error: "Unsupported Content-Type" }, { status: 415 });
}