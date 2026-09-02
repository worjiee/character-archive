import type { SourcePlatformIdentity } from "./retrieval";
import { normalizeUuidPrefix } from "./source-identifiers";

export const BULK_CHARACTER_URL_LIMIT = 100;

export type CharacterUrlIssue = "EMPTY" | "MALFORMED" | "UNSUPPORTED" | "MALFORMED_TARGET";
export type BulkRetrievalCapability = "READY" | "UNSUPPORTED";

export type CharacterUrlDetection =
  | {
      recognized: true;
      platform: SourcePlatformIdentity;
      sourceUrl: string;
      externalId: string;
      singleCapability: "EXPERIMENTAL" | "UNSUPPORTED";
      bulkCapability: BulkRetrievalCapability;
    }
  | {
      recognized: false;
      issue: CharacterUrlIssue;
      message: string;
    };

export interface BulkCharacterUrlItem {
  sourceUrl: string;
  detection: CharacterUrlDetection;
}

export interface BulkCharacterUrlAnalysis {
  items: BulkCharacterUrlItem[];
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  uniqueCount: number;
  overLimit: boolean;
  sourceCounts: Partial<Record<SourcePlatformIdentity, number>>;
}

const HOSTS: Record<string, SourcePlatformIdentity> = {
  "janitorai.com": "JANITOR_AI",
  "www.janitorai.com": "JANITOR_AI",
  "saucepan.ai": "SAUCEPAN",
  "www.saucepan.ai": "SAUCEPAN",
  "datacat.run": "DATACAT",
  "www.datacat.run": "DATACAT",
  "jannyai.com": "JANNY",
  "www.jannyai.com": "JANNY",
};

export function detectCharacterSourceUrl(input: string): CharacterUrlDetection {
  const sourceUrl = input.trim();
  if (!sourceUrl) {
    return { recognized: false, issue: "EMPTY", message: "Enter a character URL." };
  }

  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return { recognized: false, issue: "MALFORMED", message: "Enter a valid character URL." };
  }

  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    return { recognized: false, issue: "MALFORMED", message: "Enter a valid HTTPS character URL." };
  }
  if (parsed.hash) {
    return { recognized: false, issue: "MALFORMED_TARGET", message: "Character URLs cannot contain fragments." };
  }

  const platform = HOSTS[parsed.hostname.toLowerCase()];
  if (!platform) {
    return { recognized: false, issue: "UNSUPPORTED", message: "Unsupported character URL." };
  }

  const externalId = externalIdFor(platform, parsed);
  if (!externalId) {
    return {
      recognized: false,
      issue: "MALFORMED_TARGET",
      message: `This ${platformLabel(platform)} URL is not a recognized character link.`,
    };
  }

  return {
    recognized: true,
    platform,
    sourceUrl,
    externalId,
    singleCapability: platform === "JANITOR_AI" ? "EXPERIMENTAL" : "UNSUPPORTED",
    bulkCapability: "UNSUPPORTED",
  };
}

export function analyzeBulkCharacterUrls(input: string): BulkCharacterUrlAnalysis {
  const submitted = input.split(/[\n,]+/u).map((value) => value.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  let duplicateCount = 0;

  for (const sourceUrl of submitted) {
    if (seen.has(sourceUrl)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(sourceUrl);
    unique.push(sourceUrl);
  }

  const items = unique.map((sourceUrl) => ({ sourceUrl, detection: detectCharacterSourceUrl(sourceUrl) }));
  const sourceCounts: Partial<Record<SourcePlatformIdentity, number>> = {};
  let validCount = 0;
  for (const { detection } of items) {
    if (!detection.recognized) continue;
    validCount += 1;
    sourceCounts[detection.platform] = (sourceCounts[detection.platform] ?? 0) + 1;
  }

  return {
    items,
    validCount,
    invalidCount: items.length - validCount,
    duplicateCount,
    uniqueCount: items.length,
    overLimit: items.length > BULK_CHARACTER_URL_LIMIT,
    sourceCounts,
  };
}

function externalIdFor(platform: SourcePlatformIdentity, url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  if (platform === "JANITOR_AI" || platform === "JANNY") {
    if (segments.length !== 2 || segments[0] !== "characters") return null;
    return uuidPrefix(segments[1]);
  }
  if (platform === "SAUCEPAN") {
    if (segments.length !== 2 || segments[0] !== "companion") return null;
    return uuidPrefix(segments[1]);
  }
  if (platform === "DATACAT") {
    if (segments[0] !== "characters") return null;
    for (let index = segments.length - 1; index >= 1; index -= 1) {
      const id = uuidPrefix(segments[index]);
      if (id) return id;
    }
  }
  return null;
}

function uuidPrefix(value: string | undefined): string | null {
  return normalizeUuidPrefix(value);
}

function platformLabel(platform: SourcePlatformIdentity): string {
  switch (platform) {
    case "JANITOR_AI": return "Janitor AI";
    case "SAUCEPAN": return "Saucepan";
    case "DATACAT": return "Datacat";
    case "JANNY": return "Janny";
    default: return "source";
  }
}
