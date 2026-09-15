import type {
  CanonicalCharacterSnapshot,
  SnapshotGreeting,
  SnapshotLorebook,
  SnapshotLorebookEntry,
  SnapshotOverrides,
  SnapshotSource,
  SnapshotTag,
} from "./types";
import { normalizeProse } from "./fingerprint";

export interface BuildSnapshotInput {
  name: string;
  nameOverride?: string | null;
  description?: string | null;
  descriptionOverride?: string | null;
  personality?: string | null;
  personalityOverride?: string | null;
  scenario?: string | null;
  scenarioOverride?: string | null;
  exampleDialogs?: string | null;
  avatarUrl?: string | null;
  avatarUrlOverride?: string | null;
  systemPrompt?: string | null;
  postHistoryInstructions?: string | null;
  artworkSha256?: string | null;
  tokenCount?: number | null;
  permanentTokenCount?: number | null;
  createdAt?: Date | string | null;
  capturedAt?: Date | string | null;
  greetings: Array<{
    content: string;
    position: number;
    localPosition?: number | null;
    hidden?: boolean;
    externalId?: string | null;
  }>;
  tags: Array<{
    name: string;
    slug: string;
  }>;
  lorebooks?: Array<{
    externalId: string;
    title: string;
    description?: string | null;
    sourcePlatform: string;
    sourceUrl: string;
    entries: Array<{
      externalEntryId: string;
      content: string;
      keys: string[];
      category?: string | null;
      comment?: string | null;
      caseSensitive?: boolean | null;
      activationMode?: string | null;
      groupWeight?: number | null;
      enabled?: boolean;
      constant?: boolean;
      insertionOrder?: number;
    }>;
  }>;
  sources: Array<{
    platform: string;
    externalId: string;
    sourceUrl: string;
    externalCreatorId?: string | null;
    creatorName?: string | null;
    sourceCreatedAt?: Date | string | null;
    sourceUpdatedAt?: Date | string | null;
  }>;
}

function toIsoString(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString();
  try {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Builds the canonical stored snapshot for a character state.
 */
export function buildCanonicalCharacterSnapshot(
  input: BuildSnapshotInput,
): CanonicalCharacterSnapshot {
  const hasOverrides =
    Boolean(normalizeProse(input.nameOverride)) ||
    Boolean(normalizeProse(input.descriptionOverride)) ||
    Boolean(normalizeProse(input.personalityOverride)) ||
    Boolean(normalizeProse(input.scenarioOverride)) ||
    Boolean(normalizeProse(input.avatarUrlOverride));

  const overrides: SnapshotOverrides | null = hasOverrides
    ? {
        nameOverride: normalizeProse(input.nameOverride),
        descriptionOverride: normalizeProse(input.descriptionOverride),
        personalityOverride: normalizeProse(input.personalityOverride),
        scenarioOverride: normalizeProse(input.scenarioOverride),
        avatarUrlOverride: normalizeProse(input.avatarUrlOverride),
      }
    : null;

  const greetings: SnapshotGreeting[] = input.greetings
    .map((g) => ({
      content: normalizeProse(g.content) ?? "",
      position: g.localPosition ?? g.position,
      hidden: Boolean(g.hidden),
      externalId: normalizeProse(g.externalId),
    }))
    .sort((a, b) => a.position - b.position || a.content.localeCompare(b.content));

  const seenTagSlugs = new Set<string>();
  const tags: SnapshotTag[] = [];
  for (const tag of input.tags) {
    const slug = normalizeProse(tag.slug) ?? "";
    if (!slug || seenTagSlugs.has(slug)) continue;
    seenTagSlugs.add(slug);
    tags.push({
      name: normalizeProse(tag.name) ?? slug,
      slug,
    });
  }
  tags.sort((a, b) => a.slug.localeCompare(b.slug));

  const lorebooks: SnapshotLorebook[] = (input.lorebooks ?? [])
    .map((lb) => {
      const entries: SnapshotLorebookEntry[] = (lb.entries ?? [])
        .map((entry) => {
          const sortedKeys = [...(entry.keys ?? [])]
            .map((k) => normalizeProse(k) ?? "")
            .filter(Boolean)
            .sort();
          return {
            externalEntryId: String(entry.externalEntryId).trim(),
            content: normalizeProse(entry.content) ?? "",
            keys: sortedKeys,
            category: normalizeProse(entry.category),
            comment: normalizeProse(entry.comment),
            caseSensitive: entry.caseSensitive ?? null,
            activationMode: normalizeProse(entry.activationMode),
            groupWeight: entry.groupWeight ?? null,
            enabled: entry.enabled ?? true,
            constant: entry.constant ?? false,
            insertionOrder: entry.insertionOrder ?? 0,
          };
        })
        .sort((a, b) => a.insertionOrder - b.insertionOrder || a.externalEntryId.localeCompare(b.externalEntryId));

      return {
        externalId: String(lb.externalId).trim(),
        title: normalizeProse(lb.title) ?? "",
        description: normalizeProse(lb.description),
        sourcePlatform: String(lb.sourcePlatform).trim(),
        sourceUrl: String(lb.sourceUrl).trim(),
        entries,
      };
    })
    .sort((a, b) => a.externalId.localeCompare(b.externalId));

  const seenSources = new Set<string>();
  const sources: SnapshotSource[] = [];
  for (const s of input.sources) {
    const key = `${s.platform}:${s.externalId}`;
    if (seenSources.has(key)) continue;
    seenSources.add(key);
    sources.push({
      platform: String(s.platform).trim(),
      externalId: String(s.externalId).trim(),
      sourceUrl: String(s.sourceUrl).trim(),
      externalCreatorId: normalizeProse(s.externalCreatorId),
      creatorName: normalizeProse(s.creatorName),
      sourceCreatedAt: toIsoString(s.sourceCreatedAt),
      sourceUpdatedAt: toIsoString(s.sourceUpdatedAt),
    });
  }
  sources.sort((a, b) => a.platform.localeCompare(b.platform) || a.externalId.localeCompare(b.externalId));

  const nowIso = toIsoString(input.capturedAt) ?? new Date().toISOString();

  return {
    snapshotSchemaVersion: 1,
    character: {
      name: normalizeProse(input.name) ?? input.name?.trim() ?? "Unnamed",
      description: normalizeProse(input.description),
      personality: normalizeProse(input.personality),
      scenario: normalizeProse(input.scenario),
      exampleDialogs: normalizeProse(input.exampleDialogs),
      avatarUrl: normalizeProse(input.avatarUrl),
      overrides,
    },
    artwork: {
      sha256: normalizeProse(input.artworkSha256),
    },
    promptExtensions: {
      systemPrompt: normalizeProse(input.systemPrompt),
      postHistoryInstructions: normalizeProse(input.postHistoryInstructions),
    },
    greetings,
    tags,
    lorebooks,
    sources,
    tokenMetrics: {
      tokenCount: input.tokenCount ?? null,
      permanentTokenCount: input.permanentTokenCount ?? null,
      tokenizerReference: "cl100k_base_v1",
    },
    provenance: {
      originalCreatedAt: toIsoString(input.createdAt),
      capturedAt: nowIso,
    },
  };
}
