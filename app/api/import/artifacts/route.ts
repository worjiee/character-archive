import { getAuthenticatedUserApiSession, requireUserApiSession } from "@/src/lib/auth";
import {
  ARTIFACT_LIMITS,
  ARTIFACT_UPLOAD_LIMIT_LABEL,
  ArtifactImportError,
  inspectArtifact,
  type InspectedArtifactItem,
  validateArtifactUploadByteLength,
} from "@/src/lib/importers/artifacts";
import {
  cleanupImportPreviewJobs,
  persistPreparedImportPreviewJobs,
  prepareImportPreviewJob,
} from "@/src/lib/importers/preview-jobs";
import { FallbackReviewError, fallbackReviewStore } from "@/src/lib/importers/fallback-review";
import {
  getArtworkObjectStore,
  preparePendingArtwork,
  ArtworkStorageConfigurationError,
  type ArtworkObjectStore,
} from "@/src/lib/artwork/index";
import { prisma } from "@/lib/prisma";
import { isArtifactUploadEnabled } from "@/src/lib/runtime/deployment";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireUserApiSession(request);
  if (unauthorized) return unauthorized;
  if (!isArtifactUploadEnabled()) {
    return error("ARTIFACT_UPLOAD_UNAVAILABLE", "Import uploads are temporarily unavailable in this preview.", 503);
  }
  let registeredReviewIds: string[] = [];
  let registeredSessionId: string | null = null;
  let artworkStore: ArtworkObjectStore | null = null;
  const preparedArtworkKeys: string[] = [];

  try {
    const declaredLengthHeader = request.headers.get("content-length");
    const declaredLength = Number(declaredLengthHeader);
    if (declaredLengthHeader === null || !Number.isFinite(declaredLength) || declaredLength <= 0) {
      return error("UPLOAD_LENGTH_REQUIRED", "A bounded Content-Length is required for artifact uploads.", 411);
    }
    const declaredSizeError = validateArtifactUploadByteLength(declaredLength);
    if (declaredSizeError) return error("ARCHIVE_TOO_LARGE", declaredSizeError, 413);
    const contentType = request.headers.get("content-type") ?? "";
    if (!["application/octet-stream", "application/zip", "image/png", "application/json"].includes(contentType.toLowerCase().split(";", 1)[0].trim())) {
      return error("INVALID_UPLOAD", "Artifact upload must be a raw ZIP export, Character Card PNG, or Character Card JSON body.", 415);
    }
    const filename = readArtifactFilename(request.headers.get("x-artifact-filename"));
    if (!filename) return error("MISSING_UPLOAD", "Choose a ZIP export, Character Card PNG, or Character Card JSON.", 400);
    const session = await getAuthenticatedUserApiSession(request);
    if (!session) return error("AUTH_REQUIRED", "Authentication required.", 401);

    const bytes = await readExactRequestBody(request, declaredLength);
    const inspection = inspectArtifact(bytes, filename);
    if (inspection.items.some((item) => item.artwork)) {
      artworkStore = getArtworkObjectStore();
      await artworkStore.cleanupExpiredPending({ limit: 50 });
    }
    for (const item of inspection.items) {
      if (!item.artwork) continue;
      const binding = await preparePendingArtwork(
        session.sessionId,
        item.artwork.readBytes(),
        item.artwork.metadata,
        { store: artworkStore! },
      );
      preparedArtworkKeys.push(binding.pendingKey);
      item.preparedArtwork = binding;
      if (item.fallback) {
        item.fallback = { ...item.fallback, artwork: undefined, preparedArtwork: binding };
      }
    }
    const fallbackItems = inspection.items.filter((item) => item.status === "FALLBACK_REVIEW_REQUIRED" && item.fallback);
    const fallbackReviews = fallbackReviewStore.registerBatch(session.sessionId, fallbackItems.map((item) => item.fallback!));
    registeredReviewIds = fallbackReviews.map(({ reviewId }) => reviewId);
    registeredSessionId = session.sessionId;
    const fallbackByFilename = new Map(fallbackItems.map((item, index) => [item.filename, fallbackReviews[index]]));
    await cleanupImportPreviewJobs(prisma);
    const prepared: Array<{ item: InspectedArtifactItem; job: Awaited<ReturnType<typeof prepareImportPreviewJob>> }> = [];
    for (const item of inspection.items) {
      if (item.status !== "READY" || !item.character) continue;
      prepared.push({
        item,
        job: await prepareImportPreviewJob(session.sessionId, item.character, "artifact-upload", {
          client: prisma,
          artwork: item.preparedArtwork,
        }),
      });
    }
    const createdJobs = await persistPreparedImportPreviewJobs(prepared.map(({ job }) => job), prisma);
    const jobs = new Map(prepared.map((entry, index) => [entry.item.filename, createdJobs[index]]));

    return Response.json({
      kind: inspection.kind,
      manifest: inspection.manifest,
      warnings: inspection.warnings,
      items: inspection.items.map((item) => {
        const job = jobs.get(item.filename);
        return {
          filename: item.filename,
          status: item.status,
          code: item.code,
          message: item.message,
          artworkPolicy: item.artworkPolicy,
          fallbackReview: fallbackByFilename.get(item.filename),
          ...(job ? job : {}),
        };
      }),
    });
  } catch (caught) {
    if (registeredSessionId && registeredReviewIds.length > 0) {
      fallbackReviewStore.discardBatch(registeredSessionId, registeredReviewIds);
    }
    if (artworkStore) {
      await Promise.allSettled(preparedArtworkKeys.map((key) => artworkStore!.deletePending(key)));
    }
    if (caught instanceof ArtifactImportError) return error(caught.code, caught.message, caught.status);
    if (caught instanceof FallbackReviewError) return error(caught.code, caught.message, caught.status);
    if (caught instanceof ArtworkStorageConfigurationError) {
      return error("ARTWORK_STORAGE_UNAVAILABLE", caught.message, 503);
    }
    console.error("Artifact preview failed", caught);
    return error("PREVIEW_FAILED", "The artifact preview could not be created.", 500);
  }
}

async function readExactRequestBody(request: Request, declaredLength: number): Promise<Uint8Array> {
  if (!request.body) throw new ArtifactImportError("ARCHIVE_TOO_LARGE", "Choose a non-empty ZIP export or Character Card PNG.", 400);
  const bytes = new Uint8Array(declaredLength);
  const reader = request.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength || offset + value.byteLength > ARTIFACT_LIMITS.compressedBytes) {
        throw new ArtifactImportError("ARCHIVE_TOO_LARGE", `This archive is larger than the ${ARTIFACT_UPLOAD_LIMIT_LABEL} upload limit.`, 413);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== declaredLength) throw new ArtifactImportError("ARCHIVE_INVALID", "The upload body length did not match its declared Content-Length.", 400);
  return bytes;
}

function readArtifactFilename(value: string | null): string | null {
  if (!value || value.length > 720) return null;
  try {
    const decoded = decodeURIComponent(value).trim();
    if (!decoded || decoded.length > 240 || decoded.includes("\0") || /[/\\]/.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

function error(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}
