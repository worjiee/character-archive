import { describe, expect, it } from "vitest";
import {
  inspectBridgeReceiverInitialization,
  readBridgeChannelNonce,
  validateJanitorReceiverMessage,
} from "./receiver-channel";

const NONCE = "0123456789abcdef0123456789abcdef";
const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";

describe("bridge receiver channel validation", () => {
  it("reads only a valid nonce from the receiver fragment", () => {
    expect(readBridgeChannelNonce(`#channel=${NONCE}`)).toBe(NONCE);
    expect(readBridgeChannelNonce("#channel=too-short")).toBeNull();
    expect(readBridgeChannelNonce("")).toBeNull();
  });

  it("accepts the narrow channel-open shape", () => {
    expect(validateJanitorReceiverMessage({
      channelVersion: 1,
      type: "CHANNEL_OPEN",
      channelNonce: NONCE,
    })).toMatchObject({ type: "CHANNEL_OPEN", channelNonce: NONCE });
  });

  it.each([
    ["wrong nonce", { channelVersion: 1, type: "CHANNEL_OPEN", channelNonce: "0".repeat(31) }],
    ["unknown field", { channelVersion: 1, type: "CHANNEL_OPEN", channelNonce: NONCE, token: "unsafe" }],
    ["wrong platform", characterMessage({ platform: "OTHER" })],
    ["normalized payload", characterMessage({ payload: { externalId: CHARACTER_ID, name: "Theron" } })],
  ])("rejects %s", (_label, value) => {
    expect(validateJanitorReceiverMessage(value)).toBeNull();
  });

  it("accepts a structurally bounded source envelope for server validation", () => {
    expect(validateJanitorReceiverMessage(characterMessage())).toMatchObject({
      type: "CHARACTER_ENVELOPE",
      channelNonce: NONCE,
    });
  });

  it("distinguishes a direct receiver visit, missing channel, invalid channel, and valid initialization", () => {
    expect(inspectBridgeReceiverInitialization("", false)).toMatchObject({ ok: false, code: "NO_OPENER" });
    expect(inspectBridgeReceiverInitialization("", true)).toMatchObject({ ok: false, code: "MISSING_CHANNEL" });
    expect(inspectBridgeReceiverInitialization("#channel=bad", true)).toMatchObject({ ok: false, code: "INVALID_CHANNEL" });
    expect(inspectBridgeReceiverInitialization(`#channel=${NONCE}`, true)).toEqual({ ok: true, channelNonce: NONCE });
  });

  it("keeps a valid channel available across repeated Strict Mode initialization", () => {
    const hash = `#channel=${NONCE}`;
    expect(inspectBridgeReceiverInitialization(hash, true)).toEqual({ ok: true, channelNonce: NONCE });
    expect(inspectBridgeReceiverInitialization(hash, true)).toEqual({ ok: true, channelNonce: NONCE });
  });
});

function characterMessage(overrides: Record<string, unknown> = {}) {
  const envelope = {
    bridgeVersion: 1,
    messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    platform: "JANITOR_AI",
    type: "CHARACTER",
    capturedAt: "2026-08-24T10:00:00.000Z",
    source: { url: `https://janitorai.com/characters/${CHARACTER_ID}_character-theron` },
    payload: { id: CHARACTER_ID, name: "Theron" },
    ...overrides,
  };
  return {
    channelVersion: 1,
    type: "CHARACTER_ENVELOPE",
    channelNonce: NONCE,
    envelope,
  };
}
