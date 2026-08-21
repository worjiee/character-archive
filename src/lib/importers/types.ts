export type NormalizedSourcePlatform =
  | "JANITOR_AI"
  | "SAUCEPAN"
  | "DATACAT"
  | "OTHER";

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
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  rawData: unknown;
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
