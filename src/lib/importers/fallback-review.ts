import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../../generated/prisma/client";
import { normalizeSourceProse } from "../source-prose";
import { normalizeTagLabel, normalizeTagWhitespace } from "../tags/normalization";
import type { InspectedFallbackCandidate } from "./artifacts";
import { createImportPreviewJob, type CreatedImportPreviewJob } from "./preview-jobs";
import type { NormalizedCharacter, NormalizedTag } from "./types";
import { safeArtworkPreview, type PendingArtworkBinding, type SafeArtworkPreview } from "../artwork";

export const FALLBACK_REVIEW_TTL_MS = 60 * 60 * 1_000;
export const MAX_FALLBACK_REVIEW_CANDIDATES = 250;
export const MAX_FALLBACK_REVIEW_RETAINED_BYTES = 64 * 1024 * 1024;

export type FallbackReviewErrorCode =
  | "FALLBACK_INVALID"
  | "REVIEW_NOT_FOUND"
  | "REVIEW_EXPIRED"
  | "INVALID_MAPPING";

export class FallbackReviewError extends Error {
  constructor(
    readonly code: FallbackReviewErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "FallbackReviewError";
  }
}

export interface FallbackReviewSummary {
  reviewId: string;
  expiresAt: string;
  displayName: string;
  exportIndex: number;
  sourcePlatform: NormalizedCharacter["platform"];
  definitionHidden: boolean | null;
  creatorName: string | null;
  tagCount: number;
  artifacts: InspectedFallbackCandidate["artifacts"];
  artwork?: SafeArtworkPreview;
}

export interface FallbackReviewDetail extends FallbackReviewSummary {
  filename: string;
  prefill: InspectedFallbackCandidate["prefill"];
  referenceSections: InspectedFallbackCandidate["referenceSections"];
  lorebooks: Array<{
    title: string;
    entryCount: number;
    entries: Array<{ id: string; keys: string[]; preview: string }>;
  }>;
}

interface StoredFallbackReview {
  reviewId: string;
  userSessionId: string;
  createdAt: Date;
  expiresAt: Date;
  candidate: InspectedFallbackCandidate;
  previewJobId: string | null;
}

export class FallbackReviewStore {
  private readonly reviews = new Map<string, StoredFallbackReview>();

  constructor(
    private readonly maxCandidates = MAX_FALLBACK_REVIEW_CANDIDATES,
    private readonly maxRetainedBytes = MAX_FALLBACK_REVIEW_RETAINED_BYTES,
  ) {}

  registerBatch(userSessionId: string, candidates: InspectedFallbackCandidate[], now = new Date()): FallbackReviewSummary[] {
    this.cleanup(now);
    const incomingBytes = candidates.reduce((sum, candidate) => sum + candidate.retainedBytes, 0);
    const retainedBytes = [...this.reviews.values()].reduce((sum, review) => sum + review.candidate.retainedBytes, 0);
    if (this.reviews.size + candidates.length > this.maxCandidates || retainedBytes + incomingBytes > this.maxRetainedBytes) {
      throw new FallbackReviewError("FALLBACK_INVALID", "Fallback review capacity is temporarily full. Upload a smaller batch or try again later.", 413);
    }
    return candidates.map((candidate) => {
      const review: StoredFallbackReview = {
        reviewId: randomUUID(),
        userSessionId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + FALLBACK_REVIEW_TTL_MS),
        candidate,
        previewJobId: null,
      };
      this.reviews.set(review.reviewId, review);
      return toSummary(review);
    });
  }

  get(userSessionId: string, reviewId: string, now = new Date()): StoredFallbackReview {
    const review = this.reviews.get(parseReviewId(reviewId));
    if (!review || review.userSessionId !== userSessionId) {
      throw new FallbackReviewError("REVIEW_NOT_FOUND", "The fallback review could not be found.", 404);
    }
    if (review.expiresAt.getTime() <= now.getTime()) {
      this.reviews.delete(review.reviewId);
      throw new FallbackReviewError("REVIEW_EXPIRED", "Fallback review expired. Upload the artifact again to review it.", 410);
    }
    return review;
  }

  detail(userSessionId: string, reviewId: string, now = new Date()): FallbackReviewDetail {
    const review = this.get(userSessionId, reviewId, now);
    return {
      ...toSummary(review),
      filename: review.candidate.filename,
      prefill: review.candidate.prefill,
      referenceSections: review.candidate.referenceSections,
      lorebooks: review.candidate.lorebooks.map((book) => ({
        title: book.title,
        entryCount: book.entries.length,
        entries: book.entries.slice(0, 20).map((entry) => ({
          id: entry.externalEntryId,
          keys: entry.keys.slice(0, 20),
          preview: boundedPreview(entry.content),
        })),
      })),
    };
  }

  markPreview(userSessionId: string, reviewId: string, previewJobId: string, now = new Date()): void {
    this.get(userSessionId, reviewId, now).previewJobId = previewJobId;
  }

  discardBatch(userSessionId: string, reviewIds: string[]): void {
    for (const reviewId of reviewIds) {
      const review = this.reviews.get(reviewId);
      if (review?.userSessionId === userSessionId) this.reviews.delete(reviewId);
    }
  }

  cleanup(now = new Date()): number {
    let deleted = 0;
    for (const [id, review] of this.reviews) {
      if (review.expiresAt.getTime() <= now.getTime()) {
        this.reviews.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

const fallbackGlobal = globalThis as typeof globalThis & { chikpeasFallbackReviewStore?: FallbackReviewStore };
export const fallbackReviewStore = fallbackGlobal.chikpeasFallbackReviewStore ?? new FallbackReviewStore();
fallbackGlobal.chikpeasFallbackReviewStore = fallbackReviewStore;

export async function createFallbackReviewPreview(
  userSessionId: string,
  reviewId: string,
  input: unknown,
  options: {
    store?: FallbackReviewStore;
    client?: PrismaClient;
    now?: Date;
    createPreview?: (
      sessionId: string,
      character: NormalizedCharacter,
      artwork: PendingArtworkBinding | null,
    ) => Promise<CreatedImportPreviewJob>;
  } = {},
): Promise<CreatedImportPreviewJob> {
  const store = options.store ?? fallbackReviewStore;
  const now = options.now ?? new Date();
  const review = store.get(userSessionId, reviewId, now);
  const character = mapFallbackCharacter(review.candidate, input);
  const created = options.createPreview
    ? await options.createPreview(userSessionId, character, review.candidate.preparedArtwork ?? null)
    : await createImportPreviewJob(userSessionId, character, "artifact-upload", {
        client: options.client,
        now,
        artwork: review.candidate.preparedArtwork,
      });
  store.markPreview(userSessionId, reviewId, created.previewJobId, now);
  return created;
}

export function mapFallbackCharacter(candidate: InspectedFallbackCandidate, input: unknown): NormalizedCharacter {
  const mapping = parseMapping(input);
  const greetings = normalizeGreetings(mapping.firstGreeting, mapping.alternateGreetings);
  return {
    externalId: candidate.source.externalId,
    platform: candidate.source.platform,
    sourceUrl: candidate.source.sourceUrl,
    name: mapping.name,
    description: normalizeSourceProse(mapping.description),
    personality: normalizeSourceProse(mapping.personality),
    scenario: normalizeSourceProse(mapping.scenario),
    exampleDialogs: normalizeSourceProse(mapping.exampleDialogs),
    avatarUrl: candidate.source.avatarUrl,
    creator: { externalId: null, name: candidate.prefill.creatorName },
    greetings,
    tags: normalizeTags(mapping.tags),
    lorebookReferences: candidate.lorebooks.map(({ externalId, title }) => ({ externalId, title })),
    ...(candidate.lorebooks.length > 0 ? { embeddedLorebooks: candidate.lorebooks } : {}),
    sourceCreatedAt: candidate.source.sourceCreatedAt,
    sourceUpdatedAt: candidate.source.sourceUpdatedAt,
    rawData: {
      contract: "extractor-fallback-reviewed",
      filename: candidate.filename,
      definitionHidden: candidate.source.definitionHidden,
    },
  };
}

function parseMapping(value: unknown): {
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  firstGreeting: string;
  alternateGreetings: string[];
  exampleDialogs: string | null;
  tags: string[];
} {
  if (!isRecord(value)) throw invalidMapping("Fallback mapping must be an object.");
  const allowed = new Set(["name", "description", "personality", "scenario", "firstGreeting", "alternateGreetings", "exampleDialogs", "tags"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw invalidMapping("Fallback mapping contains unsupported fields.");
  return {
    name: requiredText(value.name, "Name", 300),
    description: optionalText(value.description, "Description"),
    personality: optionalText(value.personality, "Personality"),
    scenario: optionalText(value.scenario, "Scenario"),
    firstGreeting: optionalText(value.firstGreeting, "First greeting") ?? "",
    alternateGreetings: stringArray(value.alternateGreetings, "Alternate greetings", 100, 1_000_000),
    exampleDialogs: optionalText(value.exampleDialogs, "Example dialogue"),
    tags: stringArray(value.tags, "Tags", 500, 200),
  };
}

function normalizeGreetings(first: string, alternates: string[]): Array<{ content: string; position: number }> {
  const output: Array<{ content: string; position: number }> = [];
  const seen = new Set<string>();
  for (const value of [first, ...alternates]) {
    const content = normalizeSourceProse(value);
    if (!content || seen.has(content)) continue;
    seen.add(content);
    output.push({ content, position: output.length });
  }
  return output;
}

function normalizeTags(values: string[]): NormalizedTag[] {
  const output: NormalizedTag[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const name = normalizeTagWhitespace(value);
    const identity = normalizeTagLabel(name);
    if (!name || !identity || seen.has(identity)) continue;
    seen.add(identity);
    output.push({ name, slug: identity.replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "") });
  }
  return output;
}

function toSummary(review: StoredFallbackReview): FallbackReviewSummary {
  return {
    reviewId: review.reviewId,
    expiresAt: review.expiresAt.toISOString(),
    displayName: review.candidate.displayName,
    exportIndex: review.candidate.exportIndex,
    sourcePlatform: review.candidate.source.platform,
    definitionHidden: review.candidate.source.definitionHidden,
    creatorName: review.candidate.prefill.creatorName,
    tagCount: review.candidate.prefill.tags.length,
    artifacts: review.candidate.artifacts,
    ...(review.candidate.preparedArtwork
      ? { artwork: safeArtworkPreview(review.candidate.preparedArtwork, `/api/import/artifacts/reviews/${encodeURIComponent(review.reviewId)}/artwork`) }
      : {}),
  };
}

export function getFallbackReviewArtworkBinding(
  userSessionId: string,
  reviewId: string,
  options: { store?: FallbackReviewStore; now?: Date } = {},
): PendingArtworkBinding {
  const review = (options.store ?? fallbackReviewStore).get(userSessionId, reviewId, options.now ?? new Date());
  if (!review.candidate.preparedArtwork) {
    throw new FallbackReviewError("REVIEW_NOT_FOUND", "Prepared artwork could not be found.", 404);
  }
  return review.candidate.preparedArtwork;
}

function parseReviewId(value: string): string {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) {
    throw new FallbackReviewError("REVIEW_NOT_FOUND", "The fallback review could not be found.", 404);
  }
  return value;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw invalidMapping(`${field} must be a non-empty string of at most ${max} characters.`);
  return value.trim();
}

function optionalText(value: unknown, field: string, max = 1_000_000): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw invalidMapping(`${field} must be a string of at most ${max} characters.`);
  return value;
}

function stringArray(value: unknown, field: string, maxItems: number, maxItemLength: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== "string" || item.length > maxItemLength)) {
    throw invalidMapping(`${field} must be a bounded string array.`);
  }
  return value as string[];
}

function invalidMapping(message: string): FallbackReviewError {
  return new FallbackReviewError("INVALID_MAPPING", message, 422);
}

function boundedPreview(value: string): string {
  return value.length <= 280 ? value : `${value.slice(0, 277)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
