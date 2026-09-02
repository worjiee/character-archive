export const PERSISTED_SOURCE_PLATFORM_KEYS = [
  "JANITOR_AI",
  "SAUCEPAN",
  "DATACAT",
  "OTHER",
] as const;

export const SOURCE_NAVIGATION_PLATFORM_KEYS = [
  "JANITOR_AI",
  "SAUCEPAN",
  "DATACAT",
  "JANNY",
] as const;

export type PersistedSourcePlatform = (typeof PERSISTED_SOURCE_PLATFORM_KEYS)[number];
export type SourcePresentationKey = PersistedSourcePlatform | "JANNY";

export interface SourceIdentity {
  key: SourcePresentationKey;
  label: string;
  shortLabel: string;
  mark: string;
  color: string;
}

export const SOURCE_IDENTITIES: Readonly<Record<SourcePresentationKey, SourceIdentity>> = {
  JANITOR_AI: {
    key: "JANITOR_AI",
    label: "Janitor AI",
    shortLabel: "J.AI",
    mark: "J.AI",
    color: "#8b5cf6",
  },
  JANNY: {
    key: "JANNY",
    label: "Janny",
    shortLabel: "Janny",
    mark: "J",
    color: "#6366f1",
  },
  SAUCEPAN: {
    key: "SAUCEPAN",
    label: "Saucepan",
    shortLabel: "S",
    mark: "S",
    color: "#0ea5e9",
  },
  DATACAT: {
    key: "DATACAT",
    label: "Datacat",
    shortLabel: "D",
    mark: "D",
    color: "#ec4899",
  },
  OTHER: {
    key: "OTHER",
    label: "Other",
    shortLabel: "?",
    mark: "?",
    color: "#71717a",
  },
};

export function getSourceIdentity(platform: string | null | undefined): SourceIdentity {
  const key = platform?.trim().toUpperCase() as SourcePresentationKey | undefined;
  return key && Object.hasOwn(SOURCE_IDENTITIES, key)
    ? SOURCE_IDENTITIES[key]
    : SOURCE_IDENTITIES.OTHER;
}
