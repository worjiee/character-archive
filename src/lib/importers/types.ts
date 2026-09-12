export type NormalizedSourcePlatform =
  | "JANITOR_AI"
  | "SAUCEPAN"
  | "DATACAT"
  | "OTHER";

export type ImportProvider =
  | "JANITOR_AI"
  | "DATACAT"
  | "SAUCEPAN"
  | "CHARACTER_CARD"
  | "JANITOR_BRIDGE"
  | "MANUAL_JSON"
  | "ARTIFACT_UPLOAD"
  | "DEVELOPMENT_FIXTURE";

export interface NormalizedCreator {
  externalId: string | null;
  name: string | null;
}

export interface NormalizedGreeting {
  content: string;
  position: number;
}

export interface NormalizedTag {
  externalId?: string;
  name: string;
  slug: string;
}

export interface NormalizedLorebookReference {
  externalId: string;
  title: string;
}

export interface NormalizedCharacter {
  externalId: string;
  platform: NormalizedSourcePlatform;
  sourceUrl: string;
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  exampleDialogs: string | null;
  avatarUrl: string | null;
  creator: NormalizedCreator;
  greetings: NormalizedGreeting[];
  tags: NormalizedTag[];
  lorebookReferences: NormalizedLorebookReference[];
  /** Fully validated lorebooks carried inside an immutable import artifact. */
  embeddedLorebooks?: NormalizedLorebook[];
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  rawData: unknown;
}

export interface ImportProvenance {
  importProvider: ImportProvider;
  providerUrl: string;
  providerExternalId: string | null;
  providerIdentityKey: string;
  originalPlatform: NormalizedSourcePlatform;
  canonicalSourceUrl: string;
}

/** The single candidate shape every URL resolver and upload path converges on. */
export interface NormalizedImportCandidate extends NormalizedCharacter {
  provenance: ImportProvenance;
}

export interface NormalizedLorebookEntry {
  externalEntryId: string;
  content: string;
  keys: string[];
  category: string | null;
  enabled: boolean;
  constant: boolean;
  insertionOrder: number;
  comment: string | null;
  caseSensitive: boolean | null;
  activationMode: string | null;
  activationScript: string | null;
  groupWeight: number | null;
  rawData: unknown;
}

export interface NormalizedLorebook {
  externalId: string;
  platform: NormalizedSourcePlatform;
  title: string;
  description: string | null;
  sourceUrl: string;
  entries: NormalizedLorebookEntry[];
  rawData: unknown;
}
