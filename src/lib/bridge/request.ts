import { BridgeError } from "./errors";

export const MAX_BRIDGE_ENVELOPE_BYTES = 2 * 1024 * 1024;

export async function readBoundedBridgeJson(
  request: Request,
  maxBytes = MAX_BRIDGE_ENVELOPE_BYTES,
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BridgeError("BRIDGE_PAYLOAD_TOO_LARGE", "Bridge envelopes must be 2 MiB or smaller.", 413);
  }
  if (!request.body) throw new BridgeError("INVALID_BRIDGE_JSON", "A JSON request body is required.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new BridgeError("BRIDGE_PAYLOAD_TOO_LARGE", "Bridge envelopes must be 2 MiB or smaller.", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new BridgeError("INVALID_BRIDGE_JSON", "The bridge request body must be valid JSON.");
  }
}
