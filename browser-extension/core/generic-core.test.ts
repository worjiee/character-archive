import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const TARGET = {
  targetKind: "CHARACTER",
  platform: "TEST_SOURCE",
  externalId: "character-1",
  canonicalSourceUrl: "https://source.example/character/character-1",
  pageOrigin: "https://source.example",
};
const NONCE = "a".repeat(32);

describe("source-independent companion core", () => {
  const contract = loadGenericContract();

  it("binds a generic platform, origin, canonical URL, external ID, and nonce", () => {
    expect(contract.validateArmMessage({
      channel: contract.CHANNEL, version: 1, type: "ARM_SELECTED_TARGET", armNonce: NONCE, target: TARGET,
    }, TARGET)).toMatchObject({ armNonce: NONCE, target: TARGET });
    expect(contract.validateArmMessage({
      channel: contract.CHANNEL, version: 1, type: "ARM_SELECTED_TARGET", armNonce: NONCE,
      target: { ...TARGET, pageOrigin: "https://wrong.example" },
    }, TARGET)).toBeNull();
  });

  it("rejects target, message-ID, observer-version, and payload-bound mismatches", () => {
    expect(contract.validateForwardedCapture(capture(), TARGET)).toMatchObject({ target: TARGET });
    expect(contract.validateForwardedCapture(capture({ messageId: "invalid" }), TARGET)).toBeNull();
    expect(contract.validateForwardedCapture(capture({ observerContractVersion: 2 }), TARGET)).toBeNull();
    expect(contract.validateForwardedCapture(capture({ target: { ...TARGET, externalId: "character-2" } }), TARGET)).toBeNull();
    expect(contract.validateForwardedCapture(capture({ payload: { id: "character-1", body: "x".repeat(1024 * 1024) } }), TARGET)).toBeNull();
  });
});

function capture(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    capturedAt: "2026-08-24T10:00:00.000Z",
    target: TARGET,
    observerContractVersion: 1,
    payload: { id: "character-1" },
    ...overrides,
  };
}

function loadGenericContract() {
  const context: Record<string, unknown> = { URL, TextEncoder };
  runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension/core/observer-registry.js"), "utf8"), context);
  const registry = context.CharacterArchiveObserverRegistry as { register(observer: Record<string, unknown>): void };
  registry.register({
    platform: "TEST_SOURCE",
    contractVersion: 1,
    allowedOrigins: ["https://source.example"],
    matchesPage: (value: string) => value === TARGET.canonicalSourceUrl ? TARGET : null,
    matchesObservedResponse: () => true,
    extractCandidatePayload: async () => ({}),
    preflightPayload: (payload: unknown, target: typeof TARGET) => Boolean(
      payload && typeof payload === "object" && !Array.isArray(payload)
      && (payload as { id?: string }).id === target.externalId,
    ),
  });
  runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension/core/contract.js"), "utf8"), context);
  return context.CharacterArchiveCompanionContract as {
    CHANNEL: string;
    validateArmMessage(value: unknown, target: unknown): Record<string, unknown> | null;
    validateForwardedCapture(value: unknown, target: unknown): Record<string, unknown> | null;
  };
}
