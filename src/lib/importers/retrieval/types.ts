import type { NormalizedCharacter, NormalizedLorebook, NormalizedSourcePlatform } from "../types";
import type { DuplicateAnalysis } from "../duplicate-detector";

export type SourcePlatformIdentity =
  | NormalizedSourcePlatform
  | "JANNY";

export type SourceTargetType = "CHARACTER" | "CREATOR_PROFILE" | "LOREBOOK";

export interface SourceTarget {
  platform: SourcePlatformIdentity;
  type: SourceTargetType;
  externalId: string;
  canonicalUrl: string;
  rawInput: string;
}

export type ParseTargetErrorCode =
  | "INVALID_URL"
  | "UNSUPPORTED_HOST"
  | "MALFORMED_TARGET"
  | "UNSUPPORTED_SCHEME"
  | "EMBEDDED_CREDENTIALS"
  | "UNKNOWN_TARGET_TYPE";

export type ParseTargetResult =
  | { success: true; target: SourceTarget }
  | { success: false; error: string; code: ParseTargetErrorCode };

export interface SourceCapabilities {
  singleCharacter: boolean;
  creatorProfile: boolean;
  lorebooks: boolean;
  sourceTimestamps: boolean;
  authenticatedRetrieval: boolean;
  publicRetrieval: boolean;
  persistedPlatform: boolean; // false for JANNY (not persisted in Prisma, not mapped to OTHER)
}

export type CharacterRetrievalStatus =
  | "RETRIEVED"
  | "INACCESSIBLE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "MALFORMED"
  | "UNSUPPORTED";

export type LorebookRetrievalStatus =
  | "RETRIEVED"
  | "CONTENT_HIDDEN"
  | "INACCESSIBLE"
  | "NOT_FOUND"
  | "MALFORMED"
  | "UNSUPPORTED";

export interface RetrievalOptions {
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  authorization?: string | null;
}

export type RetrievalMode = "PUBLIC_ONLY" | "ADMIN_CREDENTIAL_DIAGNOSTIC";

export interface SingleRetrievalOptions extends Omit<RetrievalOptions, "authorization"> {
  mode?: RetrievalMode;
  diagnosticAuthorized?: boolean;
}

export interface RetrievedCharacterResult {
  status: CharacterRetrievalStatus;
  target: SourceTarget;
  character?: NormalizedCharacter;
  error?: string;
  retryAfterSeconds?: number;
  unauthorizedConnection?: boolean;
  connectionRequired?: boolean;
  retryable?: boolean;
  timedOut?: boolean;
}

export interface RetrievedLorebookResult {
  status: LorebookRetrievalStatus;
  target: SourceTarget;
  lorebook?: NormalizedLorebook;
  referenceOnly?: {
    externalId: string;
    title: string;
    sourceUrl: string;
  };
  error?: string;
  retryAfterSeconds?: number;
}

export interface BatchProfilePage {
  page: number;
  pageSize: number;
  hasMore: boolean;
  totalCount?: number;
  items: RetrievedCharacterResult[];
  error?: string;
}

export type BatchItemState =
  | "NEW"
  | "EXACT_EXISTING"
  | "REVIEW_REQUIRED"
  | "REJECTED"
  | "UNAVAILABLE";

export interface BatchItemPreview {
  index: number;
  externalId: string;
  name: string;
  avatarUrl: string | null;
  creatorName: string | null;
  platform: SourcePlatformIdentity;
  sourceUrl: string;
  state: BatchItemState;
  duplicateAnalysis?: DuplicateAnalysis;
  lorebookCount: number;
  greetingCount: number;
  error?: string;
}

export interface BatchPreviewSummary {
  totalFound: number;
  newCount: number;
  exactExistingCount: number;
  reviewRequiredCount: number;
  rejectedCount: number;
  unavailableCount: number;
  lorebooksDiscovered: number;
  items: BatchItemPreview[];
}
