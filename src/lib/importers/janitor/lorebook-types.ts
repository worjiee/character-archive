export interface JanitorLorebookSourceEntry {
  activationMode?: unknown;
  activationScript?: unknown;
  case_sensitive?: unknown;
  category?: unknown;
  comment?: unknown;
  constant?: unknown;
  content?: unknown;
  enabled?: unknown;
  extensions?: unknown;
  groupWeight?: unknown;
  id?: unknown;
  inclusionGroupRaw?: unknown;
  insertion_order?: unknown;
  key?: unknown;
  keyMatchPriority?: unknown;
  [key: string]: unknown;
}

export type JanitorLorebookSource = JanitorLorebookSourceEntry[];

export interface NormalizeJanitorLorebookMetadata {
  externalId: string;
  title: string;
  description?: string | null;
  sourceUrl: string;
}
