import { createHash } from "node:crypto";
import type {
  CanonicalVersionFingerprintPayload,
  FingerprintGreeting,
  FingerprintSource,
  SnapshotLorebook,
  SnapshotLorebookEntry,
  SnapshotTag,
} from "./types";

/**
 * Normalizes text with Unicode NFKC normalization and trims whitespace.
 * Returns null for empty or nullish strings.
 */
export function normalizeProse(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const normalized = text.normalize("NFKC").trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Resolves effective prose given an optional override and baseline.
 * If override is set to a non-empty string, it takes precedence.
 * Otherwise, baseline is used.
 * Changing from override=null to override="same baseline" produces identical output.
 */
export function effectiveProse(
  override: string | null | undefined,
  baseline: string | null | undefined,
): string | null {
  const normOverride = normalizeProse(override);
  if (normOverride !== null) return normOverride;
  return normalizeProse(baseline);
}

/**
 * Canonical deterministic JSON stringifier with sorted object keys and arrays.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(
    (key) => JSON.stringify(key) + ":" + canonicalStringify(obj[key]),
  );
  return "{" + pairs.join(",") + "}";
}

export interface BuildFingerprintInput {
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
  greetings: Array<{
    content: string;
    position: number;
    localPosition?: number | null;
    hidden?: boolean;
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
  }>;
}

/**
 * Extracts ONLY semantic / version-worthy fields into a CanonicalVersionFingerprintPayload.
 * Excludes operational timestamps, source author timestamps, and derived token metrics.
 */
export function buildVersionFingerprintPayload(
  input: BuildFingerprintInput,
): CanonicalVersionFingerprintPayload {
  const effectiveName =
    effectiveProse(input.nameOverride, input.name) ?? input.name?.trim() ?? "Unnamed";
  const effectiveDescription = effectiveProse(
    input.descriptionOverride,
    input.description,
  );
  const effectivePersonality = effectiveProse(
    input.personalityOverride,
    input.personality,
  );
  const effectiveScenario = effectiveProse(
    input.scenarioOverride,
    input.scenario,
  );
  const effectiveAvatarUrl = effectiveProse(
    input.avatarUrlOverride,
    input.avatarUrl,
  );

  // Normalize greetings and sort by effective position
  const greetings: FingerprintGreeting[] = input.greetings
    .map((g) => ({
      content: normalizeProse(g.content) ?? "",
      position: g.localPosition ?? g.position,
      hidden: Boolean(g.hidden),
    }))
    .sort((a, b) => a.position - b.position || a.content.localeCompare(b.content));

  // Normalize tags and sort deterministically by slug
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

  // Normalize lorebooks and entries
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

  // Normalize sources and sort deterministically by platform then externalId
  const seenSources = new Set<string>();
  const sources: FingerprintSource[] = [];
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
    });
  }
  sources.sort((a, b) => a.platform.localeCompare(b.platform) || a.externalId.localeCompare(b.externalId));

  return {
    effectiveName,
    effectiveDescription,
    effectivePersonality,
    effectiveScenario,
    exampleDialogs: normalizeProse(input.exampleDialogs),
    avatarUrl: effectiveAvatarUrl,
    systemPrompt: normalizeProse(input.systemPrompt),
    postHistoryInstructions: normalizeProse(input.postHistoryInstructions),
    artworkSha256: normalizeProse(input.artworkSha256),
    greetings,
    tags,
    lorebooks,
    sources,
  };
}

/**
 * Computes the cryptographic SHA-256 fingerprint of the semantic version payload.
 */
export function computeVersionFingerprint(
  payload: CanonicalVersionFingerprintPayload,
): string {
  const canonicalJson = canonicalStringify(payload);
  return createHash("sha256").update(canonicalJson, "utf8").digest("hex");
}
