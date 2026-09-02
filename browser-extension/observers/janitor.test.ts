import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";

describe("isolated Janitor source observer", () => {
  const { observer, registry } = loadObserver();
  const target = observer.matchesPage(`https://janitorai.com/characters/${ID}_character-theron`)!;

  it("recognizes only strict Janitor character pages and preserves canonical identity", () => {
    expect(target).toEqual({
      targetKind: "CHARACTER",
      platform: "JANITOR_AI", externalId: ID,
      canonicalSourceUrl: `https://janitorai.com/characters/${ID}`,
      pageOrigin: "https://janitorai.com",
    });
    expect(observer.matchesPage(`https://janitorai.com/profiles/${ID}`)).toBeNull();
    expect(observer.matchesPage(`https://example.com/characters/${ID}`)).toBeNull();
  });

  it("resolves strict character and profile routes with distinct target kinds", () => {
    const profile = {
      targetKind: "PROFILE",
      platform: "JANITOR_AI", profileId: ID,
      canonicalProfileUrl: `https://janitorai.com/profiles/${ID}`,
      pageOrigin: "https://www.janitorai.com",
    };
    expect(registry.resolveTarget(`https://www.janitorai.com/profiles/${ID}/?view=characters`)).toMatchObject({
      targetKind: "PROFILE", target: profile,
    });
    expect(registry.resolveTarget(`https://www.janitorai.com/profiles/${ID}_profile-of-example-creator/?view=characters`)).toMatchObject({
      targetKind: "PROFILE", target: profile,
    });
    expect(registry.resolveTarget(`https://janitorai.com/characters/${ID}_character-theron`)).toMatchObject({
      targetKind: "CHARACTER", target,
    });
    expect(observer.matchesProfilePage?.(`https://janitorai.com/profiles/${ID}#characters`)).toBeNull();
    expect(observer.matchesProfilePage?.(`https://janitorai.com/profiles/${ID}_creator-name`)).toBeNull();
    expect(observer.matchesProfilePage?.(`https://janitorai.com/users/${ID}`)).toBeNull();
  });

  it.each([
    ["valid", { method: "GET", status: 200, origin: "https://janitorai.com", pathname: `/hampter/characters/${ID}` }, true],
    ["wrong UUID", { method: "GET", status: 200, origin: "https://janitorai.com", pathname: "/hampter/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80" }, false],
    ["wrong method", { method: "POST", status: 200, origin: "https://janitorai.com", pathname: `/hampter/characters/${ID}` }, false],
    ["wrong endpoint", { method: "GET", status: 200, origin: "https://janitorai.com", pathname: `/hampter/profiles/${ID}` }, false],
    ["non-success", { method: "GET", status: 401, origin: "https://janitorai.com", pathname: `/hampter/characters/${ID}` }, false],
  ])("matches %s response truthfully", (_label, metadata, expected) => {
    expect(observer.matchesObservedResponse(metadata, target)).toBe(expected);
  });

  it("preflights only the selected Janitor payload and publishes contract version 1", () => {
    expect(observer.contractVersion).toBe(1);
    expect(observer.preflightPayload({ id: ID, name: "Theron" }, target)).toBe(true);
    expect(observer.preflightPayload({ id: "62650d46-bcda-4eac-90a5-1162cb3d5d80", name: "Other" }, target)).toBe(false);
  });
});

function loadObserver() {
  const context: Record<string, unknown> = { URL };
  runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension/core/observer-registry.js"), "utf8"), context);
  runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension/observers/janitor.js"), "utf8"), context);
  const registry = context.CharacterArchiveObserverRegistry as {
    get(platform: string): JanitorObserver;
    resolveTarget(value: string): { targetKind: "CHARACTER" | "PROFILE"; target: Record<string, unknown> } | null;
  };
  return { observer: registry.get("JANITOR_AI"), registry };
}

interface JanitorObserver {
  contractVersion: number;
  matchesPage(value: string): typeof TARGET | null;
  matchesProfilePage?(value: string): Record<string, unknown> | null;
  matchesObservedResponse(metadata: Record<string, unknown>, target: typeof TARGET): boolean;
  preflightPayload(payload: unknown, target: typeof TARGET): boolean;
}

const TARGET = {
  targetKind: "CHARACTER",
  platform: "JANITOR_AI", externalId: ID,
  canonicalSourceUrl: `https://janitorai.com/characters/${ID}`,
  pageOrigin: "https://janitorai.com",
};
