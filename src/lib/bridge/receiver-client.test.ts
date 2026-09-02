import { describe, expect, it, vi } from "vitest";
import { createBridgeReceiverController } from "./receiver-client";

const NONCE = "0123456789abcdef0123456789abcdef";
const TOKEN = "A".repeat(43);
const EXPIRES_AT = "2026-08-24T10:10:00.000Z";
const NOW = new Date("2026-08-24T10:00:00.000Z").getTime();
const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";

describe("Archive receiver-window controller", () => {
  it("announces only to exact approved Janitor origins without a wildcard", () => {
    const harness = receiverHarness();
    harness.controller.announce();
    expect(harness.postMessage).toHaveBeenCalledTimes(2);
    expect(harness.postMessage.mock.calls.map((call) => call[1])).toEqual([
      "https://janitorai.com",
      "https://www.janitorai.com",
    ]);
    expect(harness.postMessage).not.toHaveBeenCalledWith(expect.anything(), "*");
  });

  it("does not close the receiver during controller cleanup or before initialization", () => {
    const harness = receiverHarness();
    harness.controller.announce();
    harness.controller.dispose();
    expect(harness.close).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong origin", "https://attacker.example", "opener", channelOpen()],
    ["unexpected source", "https://janitorai.com", "other", channelOpen()],
    ["nonce mismatch", "https://janitorai.com", "opener", channelOpen({ channelNonce: "f".repeat(32) })],
    ["malformed message", "https://janitorai.com", "opener", { type: "CHANNEL_OPEN" }],
  ])("rejects %s", async (_label, origin, sourceKind, data) => {
    const harness = receiverHarness();
    await expect(harness.controller.handleMessage({
      origin,
      source: sourceKind === "opener" ? harness.opener : {},
      data,
    })).resolves.toBe(false);
    expect(harness.fetchImpl).not.toHaveBeenCalled();
  });

  it("exchanges pairing receiver-side and never returns the scoped token to Janitor", async () => {
    const harness = receiverHarness();
    await expect(harness.controller.handleMessage(event(channelOpen(), harness.opener))).resolves.toBe(true);
    await expect(harness.controller.pair("0101-0101-0101-0101")).resolves.toBe(true);

    expect(harness.fetchImpl).toHaveBeenCalledWith("/api/bridge/pair/exchange", expect.objectContaining({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
    }));
    const exchangeRequest = harness.fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(exchangeRequest.headers).has("Cookie")).toBe(false);
    expect(JSON.stringify(harness.postMessage.mock.calls)).not.toContain(TOKEN);
    expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "PAIR_RESULT",
      ok: true,
      expiresAt: EXPIRES_AT,
    }), "https://janitorai.com");
  });

  it("relays one valid source envelope with the receiver-held capability", async () => {
    const harness = receiverHarness();
    await harness.controller.handleMessage(event(channelOpen(), harness.opener));
    await harness.controller.pair("0101-0101-0101-0101");
    await expect(harness.controller.handleMessage(event(characterMessage(), harness.opener))).resolves.toBe(true);

    expect(harness.fetchImpl).toHaveBeenNthCalledWith(2, "/api/bridge/import", expect.objectContaining({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      body: JSON.stringify(characterMessage().envelope),
    }));
    const importRequest = harness.fetchImpl.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(importRequest.headers).get("X-Archive-Bridge-Token")).toBe(TOKEN);
    expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "IMPORT_RESULT",
      ok: true,
    }), "https://janitorai.com");
    expect(JSON.stringify(harness.postMessage.mock.calls)).not.toContain(TOKEN);

    await expect(harness.controller.handleMessage(event(characterMessage(), harness.opener))).resolves.toBe(false);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses an envelope before pairing and does not call an Archive API", async () => {
    const harness = receiverHarness();
    await expect(harness.controller.handleMessage(event(characterMessage(), harness.opener))).resolves.toBe(true);
    expect(harness.fetchImpl).not.toHaveBeenCalled();
    expect(harness.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "IMPORT_RESULT",
      ok: false,
      errorCode: "BRIDGE_NOT_PAIRED",
    }), "https://janitorai.com");
  });

  it("keeps the receiver controller usable after a visible pairing error", async () => {
    const harness = receiverHarness();
    harness.fetchImpl.mockResolvedValueOnce(Response.json({
      error: { code: "INVALID_PAIRING", message: "Invalid pairing." },
    }, { status: 401 }));
    await harness.controller.handleMessage(event(channelOpen(), harness.opener));
    await expect(harness.controller.pair("0101-0101-0101-0101")).resolves.toBe(false);
    expect(harness.statuses).toContainEqual(expect.objectContaining({
      kind: "error",
      code: "INVALID_PAIRING",
    }));
    await harness.controller.handleMessage(event(channelOpen(), harness.opener));
    expect(harness.statuses.at(-1)).toEqual(expect.objectContaining({
      kind: "error",
      code: "INVALID_PAIRING",
    }));

    await expect(harness.controller.pair("0101-0101-0101-0101")).resolves.toBe(true);
    expect(harness.fetchImpl).toHaveBeenCalledTimes(2);
  });
});

function receiverHarness() {
  const postMessage = vi.fn();
  const close = vi.fn();
  const opener = { postMessage, close };
  const statuses: unknown[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    void _init;
    if (String(input) === "/api/bridge/pair/exchange") {
      return Response.json({ bridgeToken: TOKEN, jobId: "job-1", expiresAt: EXPIRES_AT });
    }
    return Response.json({ jobId: "job-1", status: "READY" }, { status: 202 });
  });
  const controller = createBridgeReceiverController({
    channelNonce: NONCE,
    expectedOpener: opener,
    fetchImpl,
    now: () => NOW,
    onStatus: (status) => statuses.push(status),
  });
  return { controller, fetchImpl, opener, postMessage, close, statuses };
}

function event(data: unknown, source: unknown) {
  return { origin: "https://janitorai.com", source, data };
}

function channelOpen(overrides: Record<string, unknown> = {}) {
  return {
    channelVersion: 1,
    type: "CHANNEL_OPEN",
    channelNonce: NONCE,
    ...overrides,
  };
}

function characterMessage() {
  return {
    channelVersion: 1,
    type: "CHARACTER_ENVELOPE",
    channelNonce: NONCE,
    envelope: {
      bridgeVersion: 1,
      messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
      platform: "JANITOR_AI",
      type: "CHARACTER",
      capturedAt: "2026-08-24T10:00:00.000Z",
      source: { url: `https://janitorai.com/characters/${CHARACTER_ID}_character-theron` },
      payload: { id: CHARACTER_ID, name: "Theron" },
    },
  };
}
