export type CharacterVersionOrigin =
  | "BASELINE"
  | "IMPORT"
  | "REIMPORT"
  | "ADMIN_EDIT"
  | "GREETING_EDIT";

export interface SnapshotGreeting {
  content: string;
  position: number;
  hidden: boolean;
  externalId: string | null;
}

export interface SnapshotTag {
  name: string;
  slug: string;
}

export interface SnapshotLorebookEntry {
  externalEntryId: string;
  content: string;
  keys: string[];
  category: string | null;
  comment: string | null;
  caseSensitive: boolean | null;
  activationMode: string | null;
  groupWeight: number | null;
  enabled: boolean;
  constant: boolean;
  insertionOrder: number;
}

export interface SnapshotLorebook {
  externalId: string;
  title: string;
  description: string | null;
  sourcePlatform: string;
  sourceUrl: string;
  entries: SnapshotLorebookEntry[];
}

export interface SnapshotSource {
  platform: string;
  externalId: string;
  sourceUrl: string;
  externalCreatorId: string | null;
  creatorName: string | null;
  sourceCreatedAt: string | null;
  sourceUpdatedAt: string | null;
}

export interface SnapshotOverrides {
  nameOverride: string | null;
  descriptionOverride: string | null;
  personalityOverride: string | null;
  scenarioOverride: string | null;
  avatarUrlOverride: string | null;
}

export interface CanonicalCharacterSnapshot {
  snapshotSchemaVersion: 1;
  character: {
    name: string;
    description: string | null;
    personality: string | null;
    scenario: string | null;
    exampleDialogs: string | null;
    avatarUrl: string | null;
    overrides?: SnapshotOverrides | null;
  };
  artwork: {
    sha256: string | null;
  };
  promptExtensions: {
    systemPrompt: string | null;
    postHistoryInstructions: string | null;
  };
  greetings: SnapshotGreeting[];
  tags: SnapshotTag[];
  lorebooks: SnapshotLorebook[];
  sources: SnapshotSource[];
  tokenMetrics: {
    tokenCount: number | null;
    permanentTokenCount: number | null;
    tokenizerReference: "cl100k_base_v1";
  };
  provenance: {
    originalCreatedAt: string | null;
    capturedAt: string;
  };
}

export interface FingerprintGreeting {
  content: string;
  position: number;
  hidden: boolean;
}

export interface FingerprintSource {
  platform: string;
  externalId: string;
  sourceUrl: string;
  externalCreatorId: string | null;
  creatorName: string | null;
}

export interface CanonicalVersionFingerprintPayload {
  effectiveName: string;
  effectiveDescription: string | null;
  effectivePersonality: string | null;
  effectiveScenario: string | null;
  exampleDialogs: string | null;
  avatarUrl: string | null;
  systemPrompt: string | null;
  postHistoryInstructions: string | null;
  artworkSha256: string | null;
  greetings: FingerprintGreeting[];
  tags: SnapshotTag[];
  lorebooks: SnapshotLorebook[];
  sources: FingerprintSource[];
}

export interface FieldDiff<T> {
  changed: boolean;
  before: T;
  after: T;
}

export interface CharacterVersionDiffResult {
  fromVersion: number;
  toVersion: number;
  hasChanges: boolean;
  changedFieldCount: number;

  fields: {
    name: FieldDiff<string>;
    description: FieldDiff<string | null>;
    personality: FieldDiff<string | null>;
    scenario: FieldDiff<string | null>;
    exampleDialogs: FieldDiff<string | null>;
    avatarUrl: FieldDiff<string | null>;
    systemPrompt: FieldDiff<string | null>;
    postHistoryInstructions: FieldDiff<string | null>;
  };

  tokens: {
    beforeTokenCount: number | null;
    afterTokenCount: number | null;
    tokenDelta: number | null;
    beforePermanentTokenCount: number | null;
    afterPermanentTokenCount: number | null;
    permanentTokenDelta: number | null;
  };

  artwork: {
    changed: boolean;
    beforeSha256: string | null;
    afterSha256: string | null;
  };

  greetings: {
    changed: boolean;
    countBefore: number;
    countAfter: number;
    added: Array<{ position: number; content: string }>;
    removed: Array<{ position: number; content: string }>;
    modified: Array<{ position: number; beforeContent: string; afterContent: string }>;
    reordered: boolean;
  };

  tags: {
    changed: boolean;
    added: string[];
    removed: string[];
    unchanged: string[];
  };

  lorebooks: {
    changed: boolean;
    summary: string;
    addedLorebooks: string[];
    removedLorebooks: string[];
    modifiedLorebooks: Array<{
      title: string;
      entriesAdded: number;
      entriesRemoved: number;
      entriesModified: number;
    }>;
  };
}

export interface CharacterVersionItem {
  id: string;
  versionNumber: number;
  origin: CharacterVersionOrigin;
  fingerprint: string;
  changeSummary: string | null;
  artworkSha256: string | null;
  tokenCount: number | null;
  permanentTokenCount: number | null;
  createdAt: Date;
  isCurrent: boolean;
}
