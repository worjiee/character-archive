import type { PersistedSourcePlatform } from "../sources/presentation";

export type AuthorIdentity =
  | { platform: PersistedSourcePlatform; kind: "EXTERNAL_ID"; value: string }
  | { platform: PersistedSourcePlatform; kind: "CREATOR_NAME"; value: string };

export function normalizeCreatorName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

export function authorIdentityForSource(source: {
  platform: PersistedSourcePlatform;
  externalCreatorId: string | null;
  creatorName: string | null;
}): AuthorIdentity | null {
  const externalId = source.externalCreatorId?.trim();
  if (externalId) return { platform: source.platform, kind: "EXTERNAL_ID", value: externalId };
  const creatorName = normalizeCreatorName(source.creatorName ?? "");
  return creatorName ? { platform: source.platform, kind: "CREATOR_NAME", value: creatorName } : null;
}

export function authorIdentityKey(identity: AuthorIdentity): string {
  return `${identity.platform}:${identity.kind}:${identity.value}`;
}
