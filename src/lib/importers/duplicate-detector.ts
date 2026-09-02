import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import {
  getSourceIdentity,
  type PersistedSourcePlatform,
} from "../sources/presentation";
import type { NormalizedCharacter } from "./types";
import { resolveCharacterArtworkUrl } from "../artwork/presentation";

export const MAX_DUPLICATE_CANDIDATES = 5;

export type DuplicateClassification =
  | "EXACT_SOURCE"
  | "STRONG_CROSS_SOURCE_CANDIDATE"
  | "POSSIBLE_DUPLICATE"
  | "NO_MATCH";

export interface DuplicateEvidence {
  code:
    | "EXACT_SOURCE"
    | "ORIGIN_SOURCE_URL_MATCH"
    | "EXACT_NAME_AND_CREATOR_MATCH";
  label: string;
}

export interface DuplicateCandidateSource {
  platform: PersistedSourcePlatform;
  label: string;
  shortLabel: string;
  mark: string;
  color: string;
}

export interface DuplicateCandidate {
  characterId: string;
  name: string;
  avatarUrl: string | null;
  creatorName: string | null;
  sources: DuplicateCandidateSource[];
  evidence: DuplicateEvidence[];
  confidence: "STRONG" | "MEDIUM";
}

export interface DuplicateAnalysis {
  classification: DuplicateClassification;
  exactCharacterId?: string;
  candidates: DuplicateCandidate[];
}

export interface AnalyzeDuplicatesOptions {
  client?: PrismaClient | Prisma.TransactionClient;
}

export async function analyzeDuplicates(
  character: NormalizedCharacter,
  options: AnalyzeDuplicatesOptions = {},
): Promise<DuplicateAnalysis> {
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;

  // 1. Authoritative Exact Source Lookup: (platform, externalId)
  const exactSource = await database.characterSource.findUnique({
    where: {
      platform_externalId: {
        platform: character.platform,
        externalId: character.externalId,
      },
    },
    select: { characterId: true },
  });

  if (exactSource) {
    return {
      classification: "EXACT_SOURCE",
      exactCharacterId: exactSource.characterId,
      candidates: [],
    };
  }

  // 2. Bounded Candidate Query using Strong & Medium Signals
  const trimmedName = character.name.trim();
  const creatorName = character.creator.name?.trim() ?? "";
  const trimmedUrl = character.sourceUrl.trim();

  const conditions: Prisma.CharacterWhereInput[] = [];

  // Strong Signal: Exact source URL matches an existing CharacterSource
  if (trimmedUrl.length > 0) {
    conditions.push({
      sources: {
        some: {
          sourceUrl: trimmedUrl,
        },
      },
    });
  }

  // Medium Signal: Exact character name + exact creator display name match
  if (trimmedName.length > 0 && creatorName.length > 0) {
    conditions.push({
      name: { equals: trimmedName, mode: "insensitive" },
      sources: {
        some: {
          creatorName: { equals: creatorName, mode: "insensitive" },
        },
      },
    });
  }

  // If no searchable signals exist, return NO_MATCH immediately
  if (conditions.length === 0) {
    return {
      classification: "NO_MATCH",
      candidates: [],
    };
  }

  // Execute bounded candidate query (max 5, non-deleted characters only)
  const records = await database.character.findMany({
    where: {
      status: { not: "DELETED" },
      OR: conditions,
    },
    take: MAX_DUPLICATE_CANDIDATES,
    select: {
      id: true,
      name: true,
      nameOverride: true,
      avatarUrl: true,
      avatarUrlOverride: true,
      artworkSha256: true,
      sources: {
        orderBy: { firstSeenAt: "asc" },
        select: {
          platform: true,
          creatorName: true,
          sourceUrl: true,
        },
      },
    },
  });

  // 3. Evaluate Evidence per Candidate
  const candidates: DuplicateCandidate[] = [];

  for (const record of records) {
    const evidence: DuplicateEvidence[] = [];
    let hasStrong = false;

    // Check Strong Signal: Source URL match
    if (
      trimmedUrl.length > 0 &&
      record.sources.some((source) => source.sourceUrl === trimmedUrl)
    ) {
      evidence.push({
        code: "ORIGIN_SOURCE_URL_MATCH",
        label: "Origin source URL matches an existing archive source",
      });
      hasStrong = true;
    }

    // Check Medium Signal: Exact name + creator match
    const nameMatches =
      record.name.toLowerCase() === trimmedName.toLowerCase() ||
      (record.nameOverride && record.nameOverride.toLowerCase() === trimmedName.toLowerCase());
    const creatorMatches =
      creatorName.length > 0 &&
      record.sources.some(
        (source) =>
          source.creatorName &&
          source.creatorName.toLowerCase() === creatorName.toLowerCase(),
      );

    if (nameMatches && creatorMatches) {
      evidence.push({
        code: "EXACT_NAME_AND_CREATOR_MATCH",
        label: "Exact character name and creator display name match",
      });
    }

    // Only add as candidate if at least one verified strong or medium signal matched
    if (evidence.length > 0) {
      const primarySource = record.sources[0];
      candidates.push({
        characterId: record.id,
        name: record.nameOverride || record.name,
        avatarUrl: resolveCharacterArtworkUrl(record),
        creatorName: primarySource?.creatorName ?? null,
        sources: record.sources.map((source) => {
          const identity = getSourceIdentity(source.platform);
          return {
            platform: source.platform,
            label: identity.label,
            shortLabel: identity.shortLabel,
            mark: identity.mark,
            color: identity.color,
          };
        }),
        evidence,
        confidence: hasStrong ? "STRONG" : "MEDIUM",
      });
    }
  }

  if (candidates.length === 0) {
    return {
      classification: "NO_MATCH",
      candidates: [],
    };
  }

  const hasStrongCandidate = candidates.some((candidate) => candidate.confidence === "STRONG");

  return {
    classification: hasStrongCandidate
      ? "STRONG_CROSS_SOURCE_CANDIDATE"
      : "POSSIBLE_DUPLICATE",
    candidates,
  };
}
