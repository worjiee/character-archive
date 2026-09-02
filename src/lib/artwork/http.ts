export function artworkResponse(bytes: Uint8Array, options: { etag: string; pending?: boolean; request?: Request }): Response {
  const etag = `"${options.etag}"`;
  if (!options.pending && options.request?.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: finalHeaders(etag) });
  }
  return new Response(Buffer.from(bytes), {
    headers: options.pending
      ? {
          "Cache-Control": "private, no-store",
          "Content-Disposition": "inline",
          "Content-Type": "image/png",
          "X-Content-Type-Options": "nosniff",
          Vary: "Cookie",
        }
      : finalHeaders(etag),
  });
}

function finalHeaders(etag: string): Record<string, string> {
  return {
    "Cache-Control": "private, no-cache",
    "Content-Disposition": "inline",
    "Content-Type": "image/png",
    "X-Content-Type-Options": "nosniff",
    ETag: etag,
    Vary: "Cookie",
  };
}
