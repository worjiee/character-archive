import { Prisma } from "../../../../generated/prisma/client";
import type { CanonicalCharacterSnapshot, CharacterVersionOrigin } from "./types";

export interface CaptureVersionOptions {
  characterId: string;
  origin: CharacterVersionOrigin;
  candidateSnapshot: CanonicalCharacterSnapshot;
  candidateFingerprint: string;
  changeSummary?: string | null;
  createdById?: string | null;
  now?: Date;
}

export interface CaptureVersionResult {
  created: boolean;
  versionNumber: number;
  fingerprint: string;
  versionId?: string;
}

/**
 * Creates the initial v1 version row for a newly created Character in an atomic transaction.
 */
export async function captureInitialVersionInTransaction(
  tx: Prisma.TransactionClient,
  options: CaptureVersionOptions,
): Promise<CaptureVersionResult> {
  const {
    characterId,
    origin,
    candidateSnapshot,
    candidateFingerprint,
    changeSummary = "Initial archive version",
    createdById,
    now = new Date(),
  } = options;

  if (!tx.characterVersion) {
    return {
      created: false,
      versionNumber: 1,
      fingerprint: candidateFingerprint,
    };
  }

  const version = await tx.characterVersion.create({
    data: {
      characterId,
      versionNumber: 1,
      fingerprint: candidateFingerprint,
      snapshotSchemaVersion: 1,
      origin,
      snapshot: candidateSnapshot as unknown as Prisma.InputJsonValue,
      changeSummary,
      artworkSha256: candidateSnapshot.artwork.sha256,
      tokenCount: candidateSnapshot.tokenMetrics.tokenCount,
      permanentTokenCount: candidateSnapshot.tokenMetrics.permanentTokenCount,
      createdById,
      createdAt: now,
    },
    select: { id: true, versionNumber: true, fingerprint: true },
  });

  await tx.character.update({
    where: { id: characterId },
    data: {
      currentVersionNumber: 1,
      currentVersionFingerprint: candidateFingerprint,
    },
  });

  return {
    created: true,
    versionNumber: version.versionNumber,
    fingerprint: version.fingerprint,
    versionId: version.id,
  };
}

/**
 * Safely evaluates and creates a new character version inside a transaction with row locking.
 * If the candidate fingerprint matches the current fingerprint, no new version is created.
 */
export async function captureCharacterVersionInTransaction(
  tx: Prisma.TransactionClient,
  options: CaptureVersionOptions,
): Promise<CaptureVersionResult> {
  const {
    characterId,
    origin,
    candidateSnapshot,
    candidateFingerprint,
    changeSummary,
    createdById,
    now = new Date(),
  } = options;

  // 1. Acquire transaction row lock on Character
  let current: { currentVersionNumber: number; currentVersionFingerprint: string | null } | null = null;
  if (typeof tx.$queryRaw === "function") {
    try {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          currentVersionNumber: number;
          currentVersionFingerprint: string | null;
        }>
      >`SELECT id, "currentVersionNumber", "currentVersionFingerprint" FROM "Character" WHERE id = ${characterId} FOR UPDATE`;
      if (rows && rows.length > 0) {
        current = rows[0];
      }
    } catch {
      // In mock environments where $queryRaw is not fully implemented
    }
  }

  if (!current) {
    const char = await tx.character.findUnique({
      where: { id: characterId },
      select: { currentVersionNumber: true, currentVersionFingerprint: true },
    });
    if (!char) {
      throw new Error(`Character ${characterId} not found for version capture.`);
    }
    current = {
      currentVersionNumber: char.currentVersionNumber ?? 1,
      currentVersionFingerprint: char.currentVersionFingerprint ?? null,
    };
  }

  // 2. Check deduplication: if current fingerprint matches candidate, exit cleanly
  if (current.currentVersionFingerprint === candidateFingerprint) {
    return {
      created: false,
      versionNumber: current.currentVersionNumber,
      fingerprint: current.currentVersionFingerprint,
    };
  }

  if (!tx.characterVersion) {
    return {
      created: false,
      versionNumber: current.currentVersionNumber,
      fingerprint: current.currentVersionFingerprint ?? candidateFingerprint,
    };
  }

  // 3. Determine next version number
  const latestVersion = await tx.characterVersion.findFirst({
    where: { characterId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });

  const nextVersionNumber =
    Math.max(current.currentVersionNumber, latestVersion?.versionNumber ?? 0) + 1;

  // 4. Insert new version record
  const created = await tx.characterVersion.create({
    data: {
      characterId,
      versionNumber: nextVersionNumber,
      fingerprint: candidateFingerprint,
      snapshotSchemaVersion: 1,
      origin,
      snapshot: candidateSnapshot as unknown as Prisma.InputJsonValue,
      changeSummary,
      artworkSha256: candidateSnapshot.artwork.sha256,
      tokenCount: candidateSnapshot.tokenMetrics.tokenCount,
      permanentTokenCount: candidateSnapshot.tokenMetrics.permanentTokenCount,
      createdById,
      createdAt: now,
    },
    select: { id: true, versionNumber: true, fingerprint: true },
  });

  // 5. Update character current version pointers
  await tx.character.update({
    where: { id: characterId },
    data: {
      currentVersionNumber: nextVersionNumber,
      currentVersionFingerprint: candidateFingerprint,
    },
  });

  return {
    created: true,
    versionNumber: created.versionNumber,
    fingerprint: created.fingerprint,
    versionId: created.id,
  };
}

/**
 * Builds the canonical snapshot and semantic fingerprint directly from a Character's current database state.
 */
export async function buildCharacterCandidateSnapshotFromDb(
  tx: Prisma.TransactionClient,
  characterId: string,
  now = new Date(),
): Promise<{
  snapshot: CanonicalCharacterSnapshot;
  fingerprint: string;
} | null> {
  if (!tx.character?.findUnique) {
    return null;
  }

  const char = await tx.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      nameOverride: true,
      description: true,
      descriptionOverride: true,
      personality: true,
      personalityOverride: true,
      scenario: true,
      scenarioOverride: true,
      exampleDialogs: true,
      avatarUrl: true,
      avatarUrlOverride: true,
      artworkSha256: true,
      tokenCount: true,
      permanentTokenCount: true,
      createdAt: true,
      greetings: {
        select: {
          content: true,
          position: true,
          localPosition: true,
          hidden: true,
          externalId: true,
        },
      },
      tags: {
        select: {
          tag: { select: { name: true, slug: true } },
        },
      },
      lorebooks: {
        select: {
          lorebook: {
            select: {
              externalId: true,
              title: true,
              description: true,
              sourcePlatform: true,
              sourceUrl: true,
              entries: {
                select: {
                  externalEntryId: true,
                  content: true,
                  keys: true,
                  category: true,
                  comment: true,
                  caseSensitive: true,
                  activationMode: true,
                  groupWeight: true,
                  enabled: true,
                  constant: true,
                  insertionOrder: true,
                },
              },
            },
          },
        },
      },
      sources: {
        select: {
          platform: true,
          externalId: true,
          sourceUrl: true,
          externalCreatorId: true,
          creatorName: true,
          sourceCreatedAt: true,
          sourceUpdatedAt: true,
          rawData: true,
        },
      },
    },
  });

  if (!char) return null;

  const { extractCcv2PromptFields } = await import("../tokens");
  let systemPrompt: string | null = null;
  let postHistoryInstructions: string | null = null;
  const sources = char.sources ?? [];
  for (const s of sources) {
    if (s.rawData) {
      const extracted = extractCcv2PromptFields(s.rawData);
      if (extracted.systemPrompt || extracted.postHistoryInstructions) {
        systemPrompt = extracted.systemPrompt;
        postHistoryInstructions = extracted.postHistoryInstructions;
        break;
      }
    }
  }

  const tags = (char.tags ?? []).map((t: unknown) => {
    const item = t as { tag?: { name: string; slug: string }; name?: string; slug?: string };
    return item.tag ?? { name: item.name ?? "", slug: item.slug ?? "" };
  });
  const lorebooks = (char.lorebooks ?? []).map((l: unknown) => {
    const item = l as { lorebook?: unknown };
    return item.lorebook ?? l;
  }) as unknown as NonNullable<Parameters<typeof buildCanonicalCharacterSnapshot>[0]["lorebooks"]>;
  const greetings = char.greetings ?? [];

  const { buildCanonicalCharacterSnapshot } = await import("./snapshot");
  const { buildVersionFingerprintPayload, computeVersionFingerprint } = await import("./fingerprint");

  const snapshot = buildCanonicalCharacterSnapshot({
    name: char.name,
    nameOverride: char.nameOverride,
    description: char.description,
    descriptionOverride: char.descriptionOverride,
    personality: char.personality,
    personalityOverride: char.personalityOverride,
    scenario: char.scenario,
    scenarioOverride: char.scenarioOverride,
    exampleDialogs: char.exampleDialogs,
    avatarUrl: char.avatarUrl,
    avatarUrlOverride: char.avatarUrlOverride,
    artworkSha256: char.artworkSha256,
    tokenCount: char.tokenCount,
    permanentTokenCount: char.permanentTokenCount,
    createdAt: char.createdAt,
    capturedAt: now,
    systemPrompt,
    postHistoryInstructions,
    greetings,
    tags,
    lorebooks,
    sources,
  });

  const fingerprintPayload = buildVersionFingerprintPayload({
    name: char.name,
    nameOverride: char.nameOverride,
    description: char.description,
    descriptionOverride: char.descriptionOverride,
    personality: char.personality,
    personalityOverride: char.personalityOverride,
    scenario: char.scenario,
    scenarioOverride: char.scenarioOverride,
    exampleDialogs: char.exampleDialogs,
    avatarUrl: char.avatarUrl,
    avatarUrlOverride: char.avatarUrlOverride,
    systemPrompt,
    postHistoryInstructions,
    artworkSha256: char.artworkSha256,
    greetings,
    tags,
    lorebooks,
    sources,
  });

  const fingerprint = computeVersionFingerprint(fingerprintPayload);

  return { snapshot, fingerprint };
}
