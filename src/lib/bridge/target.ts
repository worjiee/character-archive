import {
  canonicalJanitorCharacterUrl,
  JANITOR_HOSTNAMES,
  parseJanitorCharacterUrl,
} from "../importers/janitor/parse-url";
import { BridgeError } from "./errors";
import { canonicalJanitorProfileUrl, parseJanitorProfileUrl } from "../importers/janitor/parse-profile-url";

export interface CharacterBridgeTarget {
  targetKind: "CHARACTER";
  platform: "JANITOR_AI";
  externalId: string;
  canonicalSourceUrl: string;
}

export interface ProfileBridgeTarget {
  targetKind: "PROFILE";
  platform: "JANITOR_AI";
  profileId: string;
  canonicalProfileUrl: string;
}

export type BridgeTarget = CharacterBridgeTarget | ProfileBridgeTarget;
export type BridgePairingRequest =
  | {
      targetKind: "CHARACTER";
      platform: "JANITOR_AI";
      characterUrl: string;
    }
  | {
      targetKind: "PROFILE";
      platform: "JANITOR_AI";
      profileUrl: string;
    };

export interface StoredBridgeTarget {
  kind: "BRIDGE_PAIRING_TARGET";
  version: 1;
  target: BridgeTarget;
}

export type ExtensionBridgeTarget = BridgeTarget & {
  pageOrigin: "https://janitorai.com" | "https://www.janitorai.com";
};

const CHARACTER_REQUEST_KEYS = new Set(["targetKind", "platform", "characterUrl"]);
const PROFILE_REQUEST_KEYS = new Set(["targetKind", "platform", "profileUrl"]);
const CHARACTER_BRIDGE_TARGET_KEYS = new Set(["targetKind", "platform", "externalId", "canonicalSourceUrl"]);
const PROFILE_BRIDGE_TARGET_KEYS = new Set(["targetKind", "platform", "profileId", "canonicalProfileUrl"]);
const TARGET_KEYS = new Set(["targetKind", "platform", "externalId", "canonicalSourceUrl", "pageOrigin"]);
const PROFILE_TARGET_KEYS = new Set(["targetKind", "platform", "profileId", "canonicalProfileUrl", "pageOrigin"]);

export function bridgePairingRequestForUrl(sourceUrl: string): BridgePairingRequest {
  const target = parseBridgeTargetUrl(sourceUrl);
  return target.targetKind === "PROFILE"
    ? { targetKind: "PROFILE", platform: target.platform, profileUrl: sourceUrl.trim() }
    : { targetKind: "CHARACTER", platform: target.platform, characterUrl: sourceUrl.trim() };
}

export function resolveBridgePairingRequest(value: unknown): BridgeTarget {
  if (!isRecord(value)) invalidPairingRequest();
  const keys = Object.keys(value);
  const isProfile = value.targetKind === "PROFILE"
    && keys.length === PROFILE_REQUEST_KEYS.size
    && keys.every((key) => PROFILE_REQUEST_KEYS.has(key));
  const isCharacter = value.targetKind === "CHARACTER"
    && keys.length === CHARACTER_REQUEST_KEYS.size
    && keys.every((key) => CHARACTER_REQUEST_KEYS.has(key));
  if ((!isProfile && !isCharacter) || value.platform !== "JANITOR_AI") invalidPairingRequest();
  const sourceUrl = isProfile ? value.profileUrl : value.characterUrl;
  if (typeof sourceUrl !== "string" || !sourceUrl.trim()) invalidPairingRequest();
  const parsed = parseBridgeTargetUrl(sourceUrl.trim());
  if (parsed.targetKind !== value.targetKind || parsed.platform !== value.platform) invalidPairingRequest();
  return parsed;
}

export function storedBridgeTarget(target: BridgeTarget): StoredBridgeTarget {
  return { kind: "BRIDGE_PAIRING_TARGET", version: 1, target };
}

export function validateStoredBridgeTarget(value: unknown): BridgeTarget {
  if (!isRecord(value) || value.kind !== "BRIDGE_PAIRING_TARGET" || value.version !== 1 || Object.keys(value).length !== 3) {
    invalidTarget();
  }
  return validateBridgeTarget(value.target);
}

export function parseBridgeTargetUrl(sourceUrl: string): BridgeTarget {
  try {
    const externalId = parseJanitorCharacterUrl(sourceUrl);
    return {
      targetKind: "CHARACTER",
      platform: "JANITOR_AI",
      externalId,
      canonicalSourceUrl: canonicalJanitorCharacterUrl(externalId),
    };
  } catch { /* Try the profile contract. */ }
  try {
    const profileId = parseJanitorProfileUrl(sourceUrl);
    return { targetKind: "PROFILE", platform: "JANITOR_AI", profileId, canonicalProfileUrl: canonicalJanitorProfileUrl(profileId) };
  } catch { throw new BridgeError("INVALID_SOURCE_URL", "A valid Janitor AI character or profile URL is required.", 400); }
}

export function validateExtensionBridgeTarget(value: unknown): ExtensionBridgeTarget {
  if (!isRecord(value)) {
    invalidTarget();
  }
  const isProfile = value.targetKind === "PROFILE" && Object.keys(value).length === PROFILE_TARGET_KEYS.size && Object.keys(value).every((key) => PROFILE_TARGET_KEYS.has(key));
  const isCharacter = value.targetKind === "CHARACTER" && Object.keys(value).length === TARGET_KEYS.size && Object.keys(value).every((key) => TARGET_KEYS.has(key));
  if (!isProfile && !isCharacter) invalidTarget();
  if (
    value.platform !== "JANITOR_AI"
    || typeof value.pageOrigin !== "string"
  ) {
    invalidTarget();
  }
  const sourceUrl = isProfile ? value.canonicalProfileUrl : value.canonicalSourceUrl;
  if (typeof sourceUrl !== "string") invalidTarget();
  const parsed = parseBridgeTargetUrl(sourceUrl);
  let pageOrigin: URL;
  try {
    pageOrigin = new URL(value.pageOrigin);
  } catch {
    invalidTarget();
  }
  if (
    pageOrigin.protocol !== "https:"
    || pageOrigin.origin !== value.pageOrigin
    || !JANITOR_HOSTNAMES.has(pageOrigin.hostname.toLowerCase())
    || (isCharacter && (!("externalId" in parsed) || typeof value.externalId !== "string" || value.externalId.toLowerCase() !== parsed.externalId || value.canonicalSourceUrl !== parsed.canonicalSourceUrl))
    || (isProfile && (!("profileId" in parsed) || typeof value.profileId !== "string" || value.profileId.toLowerCase() !== parsed.profileId || value.canonicalProfileUrl !== parsed.canonicalProfileUrl))
  ) {
    invalidTarget();
  }
  return { ...parsed, pageOrigin: pageOrigin.origin as ExtensionBridgeTarget["pageOrigin"] };
}

function validateBridgeTarget(value: unknown): BridgeTarget {
  if (!isRecord(value)) invalidTarget();
  const keys = Object.keys(value);
  const isProfile = value.targetKind === "PROFILE"
    && keys.length === PROFILE_BRIDGE_TARGET_KEYS.size
    && keys.every((key) => PROFILE_BRIDGE_TARGET_KEYS.has(key));
  const isCharacter = value.targetKind === "CHARACTER"
    && keys.length === CHARACTER_BRIDGE_TARGET_KEYS.size
    && keys.every((key) => CHARACTER_BRIDGE_TARGET_KEYS.has(key));
  if ((!isProfile && !isCharacter) || value.platform !== "JANITOR_AI") invalidTarget();
  const sourceUrl = isProfile ? value.canonicalProfileUrl : value.canonicalSourceUrl;
  if (typeof sourceUrl !== "string") invalidTarget();
  const parsed = parseBridgeTargetUrl(sourceUrl);
  if (
    parsed.targetKind !== value.targetKind
    || (isCharacter && (!("externalId" in parsed) || value.externalId !== parsed.externalId || value.canonicalSourceUrl !== parsed.canonicalSourceUrl))
    || (isProfile && (!("profileId" in parsed) || value.profileId !== parsed.profileId || value.canonicalProfileUrl !== parsed.canonicalProfileUrl))
  ) invalidTarget();
  return parsed;
}

export function sameBridgeTarget(left: BridgeTarget, right: BridgeTarget): boolean {
  if (left.targetKind === "CHARACTER" && right.targetKind === "CHARACTER") return left.platform === right.platform && left.externalId === right.externalId && left.canonicalSourceUrl === right.canonicalSourceUrl;
  if (left.targetKind === "PROFILE" && right.targetKind === "PROFILE") return left.platform === right.platform && left.profileId === right.profileId && left.canonicalProfileUrl === right.canonicalProfileUrl;
  return false;
}

export function isCharacterBridgeTarget(target: BridgeTarget): target is CharacterBridgeTarget { return target.targetKind === "CHARACTER"; }
export function isProfileBridgeTarget(target: BridgeTarget): target is ProfileBridgeTarget { return target.targetKind === "PROFILE"; }

function invalidTarget(): never {
  throw new BridgeError("INVALID_PAIRING_TARGET", "The pairing target is invalid or incompatible. Create a fresh pairing.", 409);
}

function invalidPairingRequest(): never {
  throw new BridgeError("INVALID_PAIRING_TARGET", "The requested Janitor pairing target is invalid or incompatible.", 400);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
