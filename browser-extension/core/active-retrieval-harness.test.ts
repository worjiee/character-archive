import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const PAGE_URL = `https://janitorai.com/characters/${ID}_character-theron`;
const TARGET = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: ID, canonicalSourceUrl: `https://janitorai.com/characters/${ID}`, pageOrigin: "https://janitorai.com" };

describe("source-neutral active retrieval harness", () => {
  it("does not retrieve on initialization or readiness ping", () => {
    const runtime = createRuntime();
    expect(runtime.retrieveCharacter).not.toHaveBeenCalled();
    runtime.dispatch({
      channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "ACTIVE_RETRIEVAL_PING",
      activeNonce: "a".repeat(32), target: TARGET,
    });
    expect(runtime.retrieveCharacter).not.toHaveBeenCalled();
    expect(runtime.messages).toContainEqual(expect.objectContaining({
      type: "ACTIVE_RETRIEVAL_READY", activeNonce: "a".repeat(32), target: TARGET,
    }));
  });

  it("retrieves only for an exact nonce- and target-bound explicit command", async () => {
    const runtime = createRuntime();
    runtime.dispatch({
      channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "RETRIEVE_SELECTED_CHARACTER",
      operationNonce: "invalid", target: TARGET,
    });
    runtime.dispatch({
      channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "RETRIEVE_SELECTED_CHARACTER",
      operationNonce: "b".repeat(32), target: { ...TARGET, externalId: "62650d46-bcda-4eac-90a5-1162cb3d5d80" },
    });
    expect(runtime.retrieveCharacter).not.toHaveBeenCalled();

    runtime.dispatch({
      channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "RETRIEVE_SELECTED_CHARACTER",
      operationNonce: "c".repeat(32), target: TARGET,
    });
    await vi.waitFor(() => expect(runtime.retrieveCharacter).toHaveBeenCalledExactlyOnceWith(TARGET));
    expect(runtime.messages).toContainEqual(expect.objectContaining({
      type: "ACTIVE_RETRIEVAL_RESULT", operationNonce: "c".repeat(32),
      status: "RETRIEVED", target: TARGET, payload: { id: ID, name: "Theron" },
    }));
  });

  it("rejects a simultaneous duplicate operation", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const runtime = createRuntime(vi.fn(() => pending));
    const request = (nonce: string) => ({
      channel: "CHARACTER_ARCHIVE_COMPANION", version: 1, type: "RETRIEVE_SELECTED_CHARACTER",
      operationNonce: nonce, target: TARGET,
    });
    runtime.dispatch(request("d".repeat(32)));
    runtime.dispatch(request("e".repeat(32)));
    expect(runtime.retrieveCharacter).toHaveBeenCalledTimes(1);
    expect(runtime.messages).toContainEqual(expect.objectContaining({
      operationNonce: "e".repeat(32), status: "FAILED", code: "CANCELLED",
    }));
    finish({ status: "FAILED", code: "SOURCE_UNAVAILABLE" });
    await pending;
  });
});

function createRuntime(
  retrieveCharacter: ReturnType<typeof vi.fn> = vi.fn(async () => ({ status: "RETRIEVED", payload: { id: ID, name: "Theron" } })),
) {
  let listener: ((event: Record<string, unknown>) => void) | null = null;
  const messages: Array<Record<string, unknown>> = [];
  const page: Record<string, unknown> = {
    location: { href: PAGE_URL, origin: "https://janitorai.com" },
    addEventListener: (_type: string, callback: typeof listener) => { listener = callback; },
    removeEventListener: vi.fn(),
    postMessage: (value: Record<string, unknown>) => messages.push(value),
  };
  page.globalThis = page;
  const context: Record<string, unknown> = { URL, TextEncoder };
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js", "core/active-retrieval-harness.js"]) {
    runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  }
  const adapter = {
    platform: "JANITOR_AI", contractVersion: 1, allowedOrigins: ["https://janitorai.com"],
    matchesPage: () => TARGET, preflightPayload: (payload: Record<string, unknown>) => payload.id === ID,
    retrieveCharacter,
  };
  const registry = { resolvePage: () => ({ adapter, target: TARGET }) };
  (context.CharacterArchiveActiveRetrievalHarness as { createActiveRetrievalHarness(options: Record<string, unknown>): unknown })
    .createActiveRetrievalHarness({ page, contract: context.CharacterArchiveCompanionContract, registry });
  return {
    retrieveCharacter,
    messages,
    dispatch(data: Record<string, unknown>) { listener?.({ source: page, origin: "https://janitorai.com", data }); },
  };
}
