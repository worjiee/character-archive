import { describe, expect, it } from "vitest";
import { validateJanitorCharacterBridgeEnvelope } from "./envelope";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const SOURCE_URL = `https://janitorai.com/characters/${CHARACTER_ID}`;
const TARGET = { targetKind: "CHARACTER" as const, platform: "JANITOR_AI" as const, externalId: CHARACTER_ID, canonicalSourceUrl: SOURCE_URL };

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    bridgeVersion: 1,
    observerContractVersion: 1,
    messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    platform: "JANITOR_AI",
    type: "CHARACTER",
    capturedAt: "2026-08-24T09:30:00.000Z",
    source: { url: SOURCE_URL },
    payload: { id: CHARACTER_ID, name: "Theron", description: "A token of appreciation." },
    ...overrides,
  };
}

function expectCode(value: unknown, code: string): void {
  expect(() => validateJanitorCharacterBridgeEnvelope(value, TARGET))
    .toThrowError(expect.objectContaining({ code }));
}

describe("Janitor character bridge envelope", () => {
  it("accepts a strict source-shaped version 1 character envelope", () => {
    expect(validateJanitorCharacterBridgeEnvelope(envelope(), TARGET)).toMatchObject({
      bridgeVersion: 1,
      platform: "JANITOR_AI",
      type: "CHARACTER",
      sourceUrl: SOURCE_URL,
      payload: { id: CHARACTER_ID, name: "Theron" },
    });
  });

  it.each([
    ["wrong version", { bridgeVersion: 2 }, "WRONG_BRIDGE_VERSION"],
    ["wrong observer contract", { observerContractVersion: 2 }, "SOURCE_CONTRACT_CHANGED"],
    ["wrong platform", { platform: "DATACAT" }, "WRONG_BRIDGE_PLATFORM"],
    ["wrong type", { type: "PROFILE" }, "WRONG_BRIDGE_TYPE"],
    ["malformed message ID", { messageId: "not-a-uuid" }, "INVALID_MESSAGE_ID"],
    ["malformed timestamp", { capturedAt: "tomorrow" }, "INVALID_CAPTURED_AT"],
  ])("rejects %s", (_label, overrides, code) => {
    expectCode(envelope(overrides), code);
  });

  it("rejects unknown top-level fields", () => {
    expectCode(envelope({ ownerSession: "not-allowed" }), "UNKNOWN_BRIDGE_FIELD");
  });

  it.each([
    "https://example.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character",
    "http://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character",
    "https://janitorai.com/profiles/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    `https://user:password@janitorai.com/characters/${CHARACTER_ID}_character`,
    `${SOURCE_URL}?token=not-transported`,
    `${SOURCE_URL}#fragment`,
  ])("rejects a non-Janitor character source URL", (url) => {
    expectCode(envelope({ source: { url } }), "INVALID_SOURCE_URL");
  });

  it("rejects source metadata beyond the source URL", () => {
    expectCode(envelope({ source: { url: SOURCE_URL, authorization: "secret" } }), "INVALID_SOURCE_URL");
  });

  it("rejects payload and source UUID mismatches", () => {
    expectCode(envelope({
      payload: { id: "62650d46-bcda-4eac-90a5-1162cb3d5d80", name: "Other" },
    }), "WRONG_CHARACTER");
  });

  it.each([
    ["Authorization", { authorization: "Bearer secret" }],
    ["Cookie", { nested: { cookie: "session=secret" } }],
    ["headers", { headers: { Accept: "application/json" } }],
    ["token storage", { local_storage: { token: "secret" } }],
    ["session storage", { sessionStorage: { character: "value" } }],
    ["IndexedDB", { indexed_db: { records: [] } }],
    ["Cloudflare state", { cloudflareState: { clearance: "secret" } }],
  ])("rejects %s-shaped payload data", (_label, unsafe) => {
    expectCode(envelope({ payload: { id: CHARACTER_ID, name: "Theron", ...unsafe } }), "INVALID_SOURCE_PAYLOAD");
  });

  it("does not reject ordinary prose containing the word token", () => {
    expect(validateJanitorCharacterBridgeEnvelope(envelope(), TARGET).payload.description)
      .toContain("token");
  });

  it("rejects malformed Janitor source objects", () => {
    expectCode(envelope({ payload: { id: CHARACTER_ID, name: "" } }), "INVALID_SOURCE_PAYLOAD");
  });

  it("rejects normalized or database-shaped character payloads", () => {
    expectCode(envelope({
      payload: {
        id: CHARACTER_ID,
        name: "Theron",
        externalId: CHARACTER_ID,
        sourceUrl: SOURCE_URL,
        rawData: {},
      },
    }), "INVALID_CHARACTER_SOURCE_SHAPE");
  });

  it("rejects character payloads over one MiB", () => {
    expectCode(envelope({
      payload: { id: CHARACTER_ID, name: "Theron", description: "x".repeat(1024 * 1024) },
    }), "CHARACTER_PAYLOAD_TOO_LARGE");
  });
});
