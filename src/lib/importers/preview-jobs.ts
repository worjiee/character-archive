import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type { AuthenticatedPrincipal } from "../auth";
import { previewNormalizedCharacterModeration } from "../moderation/service";
import { analyzeDuplicates } from "./duplicate-detector";
import type { DuplicateAnalysis } from "./duplicate-detector";
import type { ModerationResult } from "../moderation/matcher";
import {
  CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS,
  CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS,
  persistNormalizedCharacterInTransaction,
  type PersistNormalizedCharacterResult,
} from "./persistence/persist-normalized-character";
import {
  createImportPreviewSnapshot,
  IMPORT_PREVIEW_SNAPSHOT_VERSION,
  ImportPreviewSnapshotError,
  restoreImportPreviewSnapshot,
} from "./preview-snapshot";
import type { NormalizedCharacter } from "./types";
import { toImportPreview, type ImportPreview } from "./workflow";
import {
  getArtworkObjectStore,
  safeArtworkPreview,
  verifyAndPromotePendingArtwork,
  type ArtworkObjectStore,
  type PendingArtworkBinding,
} from "../artwork";

export const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1_000;
export const IMPORT_PREVIEW_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type ImportPreviewJobErrorCode =
  | "PREVIEW_NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "PREVIEW_CONSUMED"
  | "INVALID_SOURCE_PAYLOAD";

export class ImportPreviewJobError extends Error {
  readonly code: ImportPreviewJobErrorCode;
  readonly status: number;
  readonly savedCharacterId?: string;

  constructor(code: ImportPreviewJobErrorCode, message: string, status: number, savedCharacterId?: string) {
    super(message);
    this.name = "ImportPreviewJobError";
    this.code = code;
    this.status = status;
    this.savedCharacterId = savedCharacterId;
  }
}

export interface CreatedImportPreviewJob {
  previewJobId: string;
  expiresAt: string;
  preview: ImportPreview;
}

export type ImportPreviewProvider = "automatic-url" | "manual-json" | "browser-bridge" | "artifact-upload";

export interface PreparedImportPreviewJob extends CreatedImportPreviewJob {
  record: Prisma.ImportPreviewJobUncheckedCreateInput;
  artwork: PendingArtworkBinding | null;
}

interface PrepareImportPreviewJobOptions {
  client?: PrismaClient;
  now?: Date;
  analyze?: (character: NormalizedCharacter, client: PrismaClient) => Promise<DuplicateAnalysis>;
  moderate?: (character: NormalizedCharacter, client: PrismaClient) => Promise<ModerationResult>;
  artwork?: PendingArtworkBinding | null;
}

export async function createImportPreviewJob(
  userSessionId: string,
  character: NormalizedCharacter,
  provider: ImportPreviewProvider,
  options: { client?: PrismaClient; now?: Date; artwork?: PendingArtworkBinding | null } = {},
): Promise<CreatedImportPreviewJob> {
  const client = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now ?? new Date();

  await cleanupImportPreviewJobs(client, now);
  const prepared = await prepareImportPreviewJob(userSessionId, character, provider, {
    client,
    now,
    artwork: options.artwork,
  });
  return persistPreparedImportPreviewJob(prepared, client);
}

export async function prepareImportPreviewJob(
  userSessionId: string,
  character: NormalizedCharacter,
  provider: ImportPreviewProvider,
  options: PrepareImportPreviewJobOptions = {},
): Promise<PreparedImportPreviewJob> {
  const client = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now ?? new Date();
  const expiresAt = new Date(now.getTime() + IMPORT_PREVIEW_TTL_MS);
  const artwork = options.artwork ?? null;
  const snapshot = createImportPreviewSnapshot(character, artwork);
  const [duplicateAnalysis, moderation] = await Promise.all([
    options.analyze
      ? options.analyze(character, client)
      : analyzeDuplicates(character, { client }),
    options.moderate
      ? options.moderate(character, client)
      : previewNormalizedCharacterModeration(character, client),
  ]);
  const preview: ImportPreview = {
    ...toImportPreview(character, provider, duplicateAnalysis),
    moderation,
  };

  return {
    previewJobId: "",
    expiresAt: expiresAt.toISOString(),
    preview,
    record: {
      userSessionId,
      platform: character.platform,
      externalId: character.externalId,
      canonicalSourceUrl: character.sourceUrl,
      snapshotVersion: IMPORT_PREVIEW_SNAPSHOT_VERSION,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      expiresAt,
    },
    artwork,
  };
}

export async function persistPreparedImportPreviewJob(
  prepared: PreparedImportPreviewJob,
  client: PrismaClient | Prisma.TransactionClient,
): Promise<CreatedImportPreviewJob> {
  const job = await client.importPreviewJob.create({
    data: prepared.record,
    select: { id: true },
  });
  return {
    previewJobId: job.id,
    expiresAt: prepared.expiresAt,
    preview: withArtworkPreview(prepared.preview, prepared.artwork, job.id),
  };
}

export async function persistPreparedImportPreviewJobs(
  preparedJobs: PreparedImportPreviewJob[],
  client: PrismaClient | Prisma.TransactionClient,
): Promise<CreatedImportPreviewJob[]> {
  if (preparedJobs.length === 0) return [];

  const records = preparedJobs.map((prepared) => ({
    ...prepared.record,
    id: randomUUID(),
  }));
  const result = await client.importPreviewJob.createMany({ data: records });
  if (result.count !== records.length) {
    throw new Error("Not all prepared import preview jobs were persisted.");
  }

  return preparedJobs.map((prepared, index) => ({
    previewJobId: records[index].id,
    expiresAt: prepared.expiresAt,
    preview: withArtworkPreview(prepared.preview, prepared.artwork, records[index].id),
  }));
}

export async function saveImportPreviewJob(
  userSessionId: string,
  principal: AuthenticatedPrincipal,
  previewJobId: string,
  options: { client?: PrismaClient; now?: Date; targetCharacterId?: string; artworkStore?: ArtworkObjectStore } = {},
): Promise<PersistNormalizedCharacterResult> {
  const client = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now ?? new Date();
  const job = await findOwnedPreviewJob(client, userSessionId, previewJobId);
  validatePreviewJob(job, now);
  const restored = restoreValidatedSnapshot(job);
  const store = restored.artwork ? (options.artworkStore ?? getArtworkObjectStore()) : null;
  const promoted = restored.artwork
    ? await verifyAndPromotePendingArtwork(restored.artwork, { store: store!, now })
    : null;

  const result = await client.$transaction(async (tx) => {
    const claimed = await tx.importPreviewJob.updateMany({
      where: { id: job.id, userSessionId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) {
      throw new ImportPreviewJobError("PREVIEW_CONSUMED", "This preview has already been saved.", 409);
    }

    if (promoted) {
      const asset = await tx.artworkAsset.upsert({
        where: { sha256: promoted.sha256 },
        update: {},
        create: {
          sha256: promoted.sha256,
          mediaType: promoted.mediaType,
          byteLength: promoted.byteLength,
          width: promoted.width,
          height: promoted.height,
          storageKey: promoted.storageKey,
        },
        select: { sha256: true, mediaType: true, byteLength: true, width: true, height: true, storageKey: true },
      });
      if (
        asset.mediaType !== promoted.mediaType || asset.byteLength !== promoted.byteLength
        || asset.width !== promoted.width || asset.height !== promoted.height || asset.storageKey !== promoted.storageKey
      ) {
        throw new ImportPreviewJobError("INVALID_SOURCE_PAYLOAD", "Stored artwork metadata conflicts with the reviewed asset.", 422);
      }
    }

    // Re-evaluate current database duplicate state while preserving the exact reviewed content.
    await analyzeDuplicates(restored.character, { client: tx });
    const saved = await persistNormalizedCharacterInTransaction(tx, restored.character, {
      principal,
      targetCharacterId: options.targetCharacterId,
      now,
      artworkSha256: promoted?.sha256,
    });
    await tx.importPreviewJob.update({
      where: { id: job.id },
      data: { savedCharacterId: saved.characterId },
    });
    return saved;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS,
    timeout: CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS,
  });
  if (restored.artwork && store) {
    try { await store.deletePending(restored.artwork.pendingKey); }
    catch (error) { console.error("Saved artwork pending-object cleanup failed", error); }
  }
  return result;
}

export async function getImportPreviewJob(
  userSessionId: string,
  previewJobId: string,
  options: { client?: PrismaClient; now?: Date } = {},
): Promise<CreatedImportPreviewJob> {
  const client = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now ?? new Date();
  const job = await client.importPreviewJob.findFirst({
    where: { id: previewJobId, userSessionId },
    select: {
      id: true,
      platform: true,
      externalId: true,
      canonicalSourceUrl: true,
      snapshotVersion: true,
      snapshot: true,
      expiresAt: true,
      consumedAt: true,
      savedCharacterId: true,
    },
  });
  if (!job) throw new ImportPreviewJobError("PREVIEW_NOT_FOUND", "The import preview could not be found.", 404);
  if (job.consumedAt) throw new ImportPreviewJobError("PREVIEW_CONSUMED", "This preview has already been saved.", 409, job.savedCharacterId ?? undefined);
  if (job.expiresAt.getTime() <= now.getTime()) throw new ImportPreviewJobError("PREVIEW_EXPIRED", "Preview expired. Retrieve the character again before saving.", 410);
  if (!isSupportedSnapshotVersion(job.snapshotVersion)) throw new ImportPreviewJobError("INVALID_SOURCE_PAYLOAD", "The stored preview version is no longer supported.", 422);
  const { character, artwork } = restoreValidatedSnapshot(job);
  if (character.platform !== job.platform || character.externalId !== job.externalId || character.sourceUrl !== job.canonicalSourceUrl) {
    throw new ImportPreviewJobError("INVALID_SOURCE_PAYLOAD", "The stored preview identity is invalid.", 422);
  }
  const [duplicateAnalysis, moderation] = await Promise.all([
    analyzeDuplicates(character, { client }),
    previewNormalizedCharacterModeration(character, client),
  ]);
  return {
    previewJobId: job.id,
    expiresAt: job.expiresAt.toISOString(),
    preview: withArtworkPreview(
      { ...toImportPreview(character, "browser-bridge", duplicateAnalysis), moderation },
      artwork,
      job.id,
    ),
  };
}

export async function getImportPreviewArtworkBinding(
  userSessionId: string,
  previewJobId: string,
  options: { client?: PrismaClient; now?: Date } = {},
): Promise<PendingArtworkBinding> {
  const client = options.client ?? (await import("../../../lib/prisma")).prisma;
  const job = await findOwnedPreviewJob(client, userSessionId, previewJobId);
  validatePreviewJob(job, options.now ?? new Date());
  const { artwork } = restoreValidatedSnapshot(job);
  if (!artwork) throw new ImportPreviewJobError("PREVIEW_NOT_FOUND", "Prepared artwork could not be found.", 404);
  return artwork;
}

export async function cleanupImportPreviewJobs(client: PrismaClient, now = new Date()): Promise<number> {
  const retentionCutoff = new Date(now.getTime() - IMPORT_PREVIEW_RETENTION_MS);
  const deleted = await client.importPreviewJob.deleteMany({
    where: {
      OR: [
        { expiresAt: { lte: retentionCutoff } },
        { consumedAt: { lte: retentionCutoff } },
      ],
    },
  });
  return deleted.count;
}

type OwnedPreviewJob = Awaited<ReturnType<typeof findOwnedPreviewJob>>;

async function findOwnedPreviewJob(client: PrismaClient, userSessionId: string, previewJobId: string) {
  const job = await client.importPreviewJob.findFirst({
    where: { id: previewJobId, userSessionId },
    select: {
      id: true, platform: true, externalId: true, canonicalSourceUrl: true,
      snapshotVersion: true, snapshot: true, expiresAt: true, consumedAt: true, savedCharacterId: true,
    },
  });
  if (!job) throw new ImportPreviewJobError("PREVIEW_NOT_FOUND", "The import preview could not be found.", 404);
  return job;
}

function validatePreviewJob(job: OwnedPreviewJob, now: Date): void {
  if (job.consumedAt) throw new ImportPreviewJobError("PREVIEW_CONSUMED", "This preview has already been saved.", 409, job.savedCharacterId ?? undefined);
  if (job.expiresAt.getTime() <= now.getTime()) throw new ImportPreviewJobError("PREVIEW_EXPIRED", "Preview expired. Retrieve the character again before saving.", 410);
  if (!isSupportedSnapshotVersion(job.snapshotVersion)) throw new ImportPreviewJobError("INVALID_SOURCE_PAYLOAD", "The stored preview version is no longer supported.", 422);
}

function restoreValidatedSnapshot(job: OwnedPreviewJob) {
  try {
    const restored = restoreImportPreviewSnapshot(job.snapshot);
    if (
      restored.character.platform !== job.platform || restored.character.externalId !== job.externalId
      || restored.character.sourceUrl !== job.canonicalSourceUrl
    ) throw new ImportPreviewSnapshotError("The stored preview identity is invalid.");
    return restored;
  } catch (error) {
    if (error instanceof ImportPreviewSnapshotError) {
      throw new ImportPreviewJobError("INVALID_SOURCE_PAYLOAD", "The stored preview is invalid.", 422);
    }
    throw error;
  }
}

function isSupportedSnapshotVersion(value: number): boolean {
  return value === 1 || value === IMPORT_PREVIEW_SNAPSHOT_VERSION;
}

function withArtworkPreview(preview: ImportPreview, artwork: PendingArtworkBinding | null, previewJobId: string): ImportPreview {
  return artwork
    ? { ...preview, artwork: safeArtworkPreview(artwork, `/api/import/previews/${encodeURIComponent(previewJobId)}/artwork`) }
    : preview;
}
