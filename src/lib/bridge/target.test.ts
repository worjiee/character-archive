import { describe, expect, it } from "vitest";
import {
  bridgePairingRequestForUrl,
  parseBridgeTargetUrl,
  resolveBridgePairingRequest,
  sameBridgeTarget,
  storedBridgeTarget,
  validateExtensionBridgeTarget,
  validateStoredBridgeTarget,
} from "./target";

const PROFILE_ID = "9502024d-a6b5-4348-b556-31a37fbd6f2a";

describe("Janitor profile bridge target", () => {
  it("accepts only an exact HTTPS profile route and canonicalizes www", () => {
    expect(parseBridgeTargetUrl(`https://www.janitorai.com/profiles/${PROFILE_ID}/`)).toEqual({
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileId: PROFILE_ID,
      canonicalProfileUrl: `https://janitorai.com/profiles/${PROFILE_ID}`,
    });
    expect(parseBridgeTargetUrl(`https://janitorai.com/profiles/${PROFILE_ID}?view=characters`)).toEqual({
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileId: PROFILE_ID,
      canonicalProfileUrl: `https://janitorai.com/profiles/${PROFILE_ID}`,
    });
    for (const value of [
      `http://janitorai.com/profiles/${PROFILE_ID}`,
      `https://janitorai.com/users/${PROFILE_ID}`,
      `https://janitorai.com/profiles/${PROFILE_ID}/characters`,
      `https://janitorai.com/profiles/${PROFILE_ID}#fragment`,
    ]) expect(() => parseBridgeTargetUrl(value)).toThrow();
  });

  it("keeps profile and character capabilities structurally distinct", () => {
    const profile = validateExtensionBridgeTarget({ targetKind: "PROFILE", platform: "JANITOR_AI", profileId: PROFILE_ID, canonicalProfileUrl: `https://janitorai.com/profiles/${PROFILE_ID}`, pageOrigin: "https://www.janitorai.com" });
    const character = parseBridgeTargetUrl("https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7");
    expect(profile.pageOrigin).toBe("https://www.janitorai.com");
    expect(sameBridgeTarget(profile, character)).toBe(false);
  });

  it("builds and authoritatively resolves explicit profile and character pairing requests", () => {
    const profileUrl = `https://janitorai.com/profiles/${PROFILE_ID}_profile-of-example`;
    const profileRequest = bridgePairingRequestForUrl(profileUrl);
    expect(profileRequest).toEqual({
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileUrl,
    });
    expect(resolveBridgePairingRequest(profileRequest)).toMatchObject({
      targetKind: "PROFILE",
      profileId: PROFILE_ID,
      canonicalProfileUrl: `https://janitorai.com/profiles/${PROFILE_ID}`,
    });

    const characterUrl = "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron";
    expect(resolveBridgePairingRequest(bridgePairingRequestForUrl(characterUrl))).toMatchObject({
      targetKind: "CHARACTER",
      externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    });
  });

  it("rejects claimed target kinds that disagree with the independently parsed URL", () => {
    const profileUrl = `https://janitorai.com/profiles/${PROFILE_ID}_profile-of-example`;
    const characterUrl = "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron";
    expect(() => resolveBridgePairingRequest({ targetKind: "CHARACTER", platform: "JANITOR_AI", characterUrl: profileUrl }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PAIRING_TARGET", status: 400 }));
    expect(() => resolveBridgePairingRequest({ targetKind: "PROFILE", platform: "JANITOR_AI", profileUrl: characterUrl }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PAIRING_TARGET", status: 400 }));
  });

  it("stores and validates the explicit discriminator without reclassifying fields", () => {
    const target = parseBridgeTargetUrl(`https://janitorai.com/profiles/${PROFILE_ID}`);
    expect(validateStoredBridgeTarget(storedBridgeTarget(target))).toEqual(target);
    expect(() => validateStoredBridgeTarget({
      ...storedBridgeTarget(target),
      target: { ...target, targetKind: "CHARACTER" },
    })).toThrowError(expect.objectContaining({ code: "INVALID_PAIRING_TARGET" }));
  });
});
