import { describe, expect, it } from "vitest";
import { readBoundedBridgeJson } from "./request";

describe("bounded bridge request reader", () => {
  it("reads valid JSON within the byte limit", async () => {
    const request = new Request("http://localhost/api/bridge/import", {
      method: "POST",
      body: JSON.stringify({ ok: true }),
    });
    await expect(readBoundedBridgeJson(request, 64)).resolves.toEqual({ ok: true });
  });

  it("rejects a declared oversized payload before reading", async () => {
    const request = new Request("http://localhost/api/bridge/import", {
      method: "POST",
      headers: { "Content-Length": "65" },
      body: "{}",
    });
    await expect(readBoundedBridgeJson(request, 64))
      .rejects.toMatchObject({ code: "BRIDGE_PAYLOAD_TOO_LARGE", status: 413 });
  });

  it("rejects streamed content that exceeds the limit despite a missing Content-Length", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(80)));
        controller.enqueue(new TextEncoder().encode('"}'));
        controller.close();
      },
    });
    const request = new Request("http://localhost/api/bridge/import", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBoundedBridgeJson(request, 64))
      .rejects.toMatchObject({ code: "BRIDGE_PAYLOAD_TOO_LARGE", status: 413 });
  });
});
