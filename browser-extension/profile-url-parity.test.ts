import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  canonicalJanitorProfileUrl,
  parseJanitorProfileUrl,
} from "../src/lib/importers/janitor/parse-profile-url";
import { parseBridgeTargetUrl, sameBridgeTarget } from "../src/lib/bridge/target";

const PROFILE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_PROFILE_ID = "00000000-0000-4000-8000-000000000002";
const CANONICAL_URL = `https://janitorai.com/profiles/${PROFILE_ID}`;

describe("Janitor profile URL browser/server parity", () => {
  const { contract, registry } = loadBrowserContract();

  it.each([
    ["bare UUID", CANONICAL_URL],
    ["bare UUID with trailing slash", `${CANONICAL_URL}/`],
    ["proven suffix", `${CANONICAL_URL}_profile-of-example`],
    ["hyphenated slug and query", `${CANONICAL_URL}_profile-of-example-creator?view=characters`],
    ["www, suffix, trailing slash, and query", `https://www.janitorai.com/profiles/${PROFILE_ID}_profile-of-renamed-user/?tab=characters`],
  ])("resolves %s to one canonical UUID identity", (_label, input) => {
    const browserResolution = registry.resolveTarget(input);
    const browserTarget = contract.matchPage(input);
    const serverTarget = parseBridgeTargetUrl(input);

    expect(parseJanitorProfileUrl(input)).toBe(PROFILE_ID);
    expect(canonicalJanitorProfileUrl(PROFILE_ID)).toBe(CANONICAL_URL);
    expect(browserResolution).toMatchObject({ targetKind: "PROFILE" });
    expect(browserTarget).toMatchObject({
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileId: PROFILE_ID,
      canonicalProfileUrl: CANONICAL_URL,
    });
    expect(serverTarget).toEqual({
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileId: PROFILE_ID,
      canonicalProfileUrl: CANONICAL_URL,
    });
  });

  it.each([
    ["HTTP", `http://janitorai.com/profiles/${PROFILE_ID}_profile-of-example`],
    ["lookalike host", `https://janitorai.com.evil.example/profiles/${PROFILE_ID}_profile-of-example`],
    ["fragment", `${CANONICAL_URL}_profile-of-example#characters`],
    ["arbitrary suffix", `${CANONICAL_URL}_creator-name`],
    ["missing slug", `${CANONICAL_URL}_profile-of-`],
    ["malformed slug", `${CANONICAL_URL}_profile-of-example--creator`],
    ["noncanonical suffix case", `${CANONICAL_URL}_PROFILE-OF-example`],
    ["nested route", `${CANONICAL_URL}_profile-of-example/characters`],
    ["missing UUID", "https://janitorai.com/profiles/_profile-of-example"],
  ])("rejects %s identically", (_label, input) => {
    expect(() => parseJanitorProfileUrl(input)).toThrow("Invalid Janitor profile URL.");
    expect(() => parseBridgeTargetUrl(input)).toThrow();
    expect(registry.resolveTarget(input)).toBeNull();
    expect(contract.matchPage(input)).toBeNull();
  });

  it("ignores a valid mutable slug but never a different UUID", () => {
    const first = contract.matchPage(`${CANONICAL_URL}_profile-of-example-creator`);
    const renamed = contract.matchPage(`${CANONICAL_URL}_profile-of-renamed-user`);
    const other = contract.matchPage(`https://janitorai.com/profiles/${OTHER_PROFILE_ID}_profile-of-example-creator`);
    const serverFirst = parseBridgeTargetUrl(`${CANONICAL_URL}_profile-of-example-creator`);
    const serverRenamed = parseBridgeTargetUrl(`${CANONICAL_URL}_profile-of-renamed-user`);
    const serverOther = parseBridgeTargetUrl(`https://janitorai.com/profiles/${OTHER_PROFILE_ID}_profile-of-example-creator`);

    expect(contract.sameTarget(first, renamed)).toBe(true);
    expect(contract.sameTarget(first, other)).toBe(false);
    expect(sameBridgeTarget(serverFirst, serverRenamed)).toBe(true);
    expect(sameBridgeTarget(serverFirst, serverOther)).toBe(false);
  });
});

function loadBrowserContract() {
  const context: Record<string, unknown> = { URL, TextEncoder };
  for (const path of ["core/observer-registry.js", "observers/janitor.js", "core/contract.js"]) {
    runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8"), context);
  }
  return {
    contract: context.CharacterArchiveCompanionContract as {
      matchPage(value: string): Record<string, unknown> | null;
      sameTarget(left: unknown, right: unknown): boolean;
    },
    registry: context.CharacterArchiveObserverRegistry as {
      resolveTarget(value: string): { targetKind: "CHARACTER" | "PROFILE"; target: Record<string, unknown> } | null;
    },
  };
}
