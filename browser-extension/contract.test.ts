import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const PAGE_URL = `https://janitorai.com/characters/${CHARACTER_ID}_character-theron`;
const CANONICAL_URL = `https://janitorai.com/characters/${CHARACTER_ID}`;
const ARM_NONCE = "a".repeat(32);
const TARGET = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: CHARACTER_ID, canonicalSourceUrl: CANONICAL_URL, pageOrigin: "https://janitorai.com" };

describe("source-neutral companion contract", () => {
  const contract = loadContract();

  it("accepts the exact observer target, nonce, message ID, contract version, and bounded payload", () => {
    expect(contract.validatePageCaptureMessage(pageMessage(), PAGE_URL, ARM_NONCE)).toMatchObject({
      target: TARGET,
      observerContractVersion: 1,
      payload: { id: CHARACTER_ID, name: "Theron" },
    });
  });

  it.each([
    ["wrong nonce", { ...pageMessage(), armNonce: "b".repeat(32) }],
    ["wrong message id", { ...pageMessage(), messageId: "not-a-uuid" }],
    ["unknown field", { ...pageMessage(), arbitrary: true }],
    ["wrong observer contract", { ...pageMessage(), observerContractVersion: 2 }],
    ["wrong target", { ...pageMessage(), target: { ...TARGET, externalId: "62650d46-bcda-4eac-90a5-1162cb3d5d80" } }],
    ["payload mismatch", { ...pageMessage(), payload: { id: "62650d46-bcda-4eac-90a5-1162cb3d5d80", name: "Other" } }],
  ])("rejects %s", (_label, value) => {
    expect(contract.validatePageCaptureMessage(value, PAGE_URL, ARM_NONCE)).toBeNull();
  });

  it("rejects credential-shaped and oversized payloads", () => {
    expect(contract.validatePageCaptureMessage(pageMessage({ id: CHARACTER_ID, name: "Theron", authorization: "secret" }), PAGE_URL, ARM_NONCE)).toBeNull();
    expect(contract.validatePageCaptureMessage(pageMessage({ id: CHARACTER_ID, name: "Theron", description: "x".repeat(1024 * 1024) }), PAGE_URL, ARM_NONCE)).toBeNull();
  });

  it("creates the generic authoritative bridge envelope", () => {
    const capture = contract.validatePageCaptureMessage(pageMessage(), PAGE_URL, ARM_NONCE);
    expect(contract.createBridgeEnvelope(capture)).toEqual({
      bridgeVersion: 1,
      observerContractVersion: 1,
      messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
      platform: "JANITOR_AI",
      type: "CHARACTER",
      capturedAt: "2026-08-24T10:00:00.000Z",
      source: { url: CANONICAL_URL },
      payload: { id: CHARACTER_ID, name: "Theron" },
    });
  });

  it("keeps source route knowledge out of the generic core", () => {
    const core = readFileSync(resolve(process.cwd(), "browser-extension/core/contract.js"), "utf8");
    expect(core).not.toContain("/hampter/");
    expect(core).not.toContain("JANITOR_CHARACTER_CAPTURED");
  });
});

function pageMessage(payload: Record<string, unknown> = { id: CHARACTER_ID, name: "Theron" }) {
  return {
    channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "SOURCE_CHARACTER_CAPTURED",
    armNonce: ARM_NONCE, messageId: "4ebda3a1-46fc-43ef-b1d4-eed058f23f2f",
    capturedAt: "2026-08-24T10:00:00.000Z", target: TARGET, observerContractVersion: 1, payload,
  };
}

function loadContract() {
  const context: Record<string, unknown> = { URL, TextEncoder };
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js"]) {
    runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  }
  return context.CharacterArchiveCompanionContract as {
    validatePageCaptureMessage(value: unknown, sourceUrl: string, armNonce: string): Record<string, unknown> | null;
    createBridgeEnvelope(capture: unknown): Record<string, unknown>;
  };
}
