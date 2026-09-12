import type { NormalizedCharacter, NormalizedImportCandidate } from "../types";
import type { DuplicateAnalysis } from "../duplicate-detector";
import { analyzeDuplicates } from "../duplicate-detector";
import { SourceRetrievalError } from "./adapter";
import type { SourceAdapterRegistry } from "./registry";
import { defaultSourceRegistry } from "./registry";
import type {
  BatchItemPreview,
  BatchItemState,
  BatchPreviewSummary,
  BatchProfilePage,
  ParseTargetResult,
  RetrievalOptions,
  SingleRetrievalOptions,
  RetrievedCharacterResult,
  RetrievedLorebookResult,
  SourceTarget,
  SourceSupportState,
} from "./types";

import type { SourceCredentialProvider } from "./credential-provider";
import { defaultCredentialProvider } from "./credential-provider";

export interface SourceOrchestratorDependencies {
  registry?: SourceAdapterRegistry;
  analyzeDuplicates?: (character: NormalizedCharacter) => Promise<DuplicateAnalysis>;
  credentialProvider?: SourceCredentialProvider;
}

export class SourceRetrievalOrchestrator {
  private readonly registry: SourceAdapterRegistry;
  private readonly duplicateAnalyzer: (
    character: NormalizedCharacter,
  ) => Promise<DuplicateAnalysis>;
  private readonly credentialProvider: SourceCredentialProvider;

  constructor(dependencies: SourceOrchestratorDependencies = {}) {
    this.registry = dependencies.registry ?? defaultSourceRegistry;
    this.duplicateAnalyzer = dependencies.analyzeDuplicates ?? analyzeDuplicates;
    this.credentialProvider = dependencies.credentialProvider ?? defaultCredentialProvider;
  }

  parseInput(input: string): ParseTargetResult {
    return this.registry.resolveTarget(input);
  }

  supportState(input: string): { state: SourceSupportState; detectedProvider: SourceTarget["importProvider"] | null; resolution: ParseTargetResult } {
    const resolution = this.parseInput(input);
    return {
      state: this.registry.supportState(resolution),
      detectedProvider: resolution.success ? (resolution.target.importProvider ?? resolution.target.platform) : null,
      resolution,
    };
  }

  async retrieveSingleCharacter(
    input: string,
    options: SingleRetrievalOptions = {},
  ): Promise<NormalizedCharacter> {
    const candidate = await this.retrieveSingleCandidate(input, options);
    const original = (candidate as NormalizedImportCandidate & { __originalCharacter?: NormalizedCharacter }).__originalCharacter;
    if (original) return original;
    const { provenance: _provenance, ...character } = candidate;
    void _provenance;
    return character;
  }

  async retrieveSingleCandidate(
    input: string,
    options: SingleRetrievalOptions = {},
  ): Promise<NormalizedImportCandidate> {
    const parsed = this.parseInput(input);
    if (!parsed.success) {
      const platform = input.toLowerCase().includes("janitorai.com")
        ? "JANITOR_AI"
        : "OTHER";
      throw normalizedParseError(platform, parsed.code);
    }

    const target = parsed.target;
    if (target.type !== "CHARACTER") {
      throw new SourceRetrievalError(
        target.platform,
        "UNSUPPORTED_SOURCE",
        "This source target is not supported for Single Retrieve.",
      );
    }

    const mode = options.mode ?? "PUBLIC_ONLY";
    if (mode === "ADMIN_CREDENTIAL_DIAGNOSTIC" && !options.diagnosticAuthorized) {
      throw new SourceRetrievalError(
        target.platform,
        "AUTH_REQUIRED",
        "Administrator authorization is required for credential diagnostics.",
      );
    }

    let authHeader: string | null = null;
    if (mode === "ADMIN_CREDENTIAL_DIAGNOSTIC") {
      authHeader = await this.credentialProvider.getAuthorizationHeader(target.platform);
    }

    const retrieved = await this.retrieveCharacterWithRetries(target, {
      ...options,
      authorization: authHeader,
    });

    if (retrieved.unauthorizedConnection) {
      throw new SourceRetrievalError(
        target.platform,
        "AUTH_REQUIRED",
        "The configured source credential was rejected.",
      );
    }

    if (retrieved.connectionRequired) {
      throw new SourceRetrievalError(
        target.platform,
        "AUTH_REQUIRED",
        "This source does not permit public server retrieval.",
      );
    }

    if (retrieved.status !== "RETRIEVED" || !retrieved.character) {
      throw normalizedRetrievalError(target.platform, retrieved);
    }

    const character = retrieved.character;
    const resolvedTarget = retrieved.target;
    const candidate: NormalizedImportCandidate = {
      ...character,
      provenance: {
        importProvider: resolvedTarget.importProvider === "OTHER" || resolvedTarget.importProvider === "JANNY"
          ? "JANITOR_AI"
          : resolvedTarget.importProvider ?? "JANITOR_AI",
        providerUrl: resolvedTarget.canonicalUrl,
        providerExternalId: resolvedTarget.externalId,
        providerIdentityKey: `id:${resolvedTarget.externalId}`,
        originalPlatform: resolvedTarget.originalPlatform === "JANNY" ? "OTHER" : resolvedTarget.originalPlatform ?? character.platform,
        canonicalSourceUrl: character.sourceUrl,
      },
    };
    Object.defineProperty(candidate, "__originalCharacter", { value: character, enumerable: false });
    return candidate;
  }

  async previewSingle(
    input: string,
    options?: SingleRetrievalOptions,
  ): Promise<{
    character: NormalizedCharacter;
    duplicateAnalysis: DuplicateAnalysis;
  }> {
    const character = await this.retrieveSingleCharacter(input, options);
    const duplicateAnalysis = await this.duplicateAnalyzer(character);
    return {
      character,
      duplicateAnalysis,
    };
  }

  async previewSingleCandidate(
    input: string,
    options?: SingleRetrievalOptions,
  ): Promise<{ candidate: NormalizedImportCandidate; duplicateAnalysis: DuplicateAnalysis }> {
    const candidate = await this.retrieveSingleCandidate(input, options);
    return { candidate, duplicateAnalysis: await this.duplicateAnalyzer(candidate) };
  }

  private async retrieveCharacterWithRetries(
    target: SourceTarget,
    options: RetrievalOptions,
  ): Promise<RetrievedCharacterResult> {
    const startedAt = Date.now();
    const overallBudgetMs = 30_000;
    let last: RetrievedCharacterResult | undefined;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const elapsed = Date.now() - startedAt;
      const remaining = overallBudgetMs - elapsed;
      if (remaining <= 0) break;
      last = await this.retrieveCharacter(target, {
        ...options,
        timeoutMs: Math.min(options.timeoutMs ?? 10_000, remaining),
      });
      if (!last.retryable || attempt === 2) return last;

      const baseDelay = last.retryAfterSeconds !== undefined
        ? Math.min(last.retryAfterSeconds * 1_000, 2_000)
        : Math.min(250 * 2 ** attempt, 1_000);
      const delay = Math.min(baseDelay + Math.floor(Math.random() * 100), overallBudgetMs - (Date.now() - startedAt));
      if (delay <= 0) break;
      await waitForRetry(delay, options.signal);
    }

    return last ?? {
      status: "INACCESSIBLE",
      target,
      error: "Single retrieval exceeded its overall time budget.",
      timedOut: true,
    };
  }

  async retrieveCharacter(
    target: SourceTarget,
    options?: RetrievalOptions,
  ): Promise<RetrievedCharacterResult> {
    const adapter = this.registry.getAdapter(target.platform);
    if (!adapter) {
      return {
        status: "UNSUPPORTED",
        target,
        error: `No adapter registered for platform ${target.platform}.`,
      };
    }
    return adapter.retrieveCharacter(target, options);
  }

  async retrieveLorebook(
    target: SourceTarget,
    options?: RetrievalOptions,
  ): Promise<RetrievedLorebookResult> {
    const adapter = this.registry.getAdapter(target.platform);
    if (!adapter || !adapter.retrieveLorebook) {
      return {
        status: "UNSUPPORTED",
        target,
        error: `Platform ${target.platform} does not support lorebook retrieval.`,
      };
    }
    return adapter.retrieveLorebook(target, options);
  }

  async retrieveProfilePage(
    target: SourceTarget,
    page: number,
    pageSize: number,
    options?: RetrievalOptions,
  ): Promise<BatchProfilePage> {
    const adapter = this.registry.getAdapter(target.platform);
    if (!adapter || !adapter.retrieveProfilePage) {
      return {
        page,
        pageSize,
        hasMore: false,
        items: [],
        error: `Platform ${target.platform} does not support profile streaming retrieval.`,
      };
    }
    return adapter.retrieveProfilePage(target, page, pageSize, options);
  }

  async buildBatchPreviewSummary(
    items: RetrievedCharacterResult[],
  ): Promise<BatchPreviewSummary> {
    const previews: BatchItemPreview[] = [];
    let newCount = 0;
    let exactExistingCount = 0;
    let reviewRequiredCount = 0;
    let rejectedCount = 0;
    let unavailableCount = 0;
    let lorebooksDiscovered = 0;

    for (const [index, item] of items.entries()) {
      if (item.status !== "RETRIEVED" || !item.character) {
        unavailableCount++;
        previews.push({
          index,
          externalId: item.target.externalId,
          name: "Unavailable character",
          avatarUrl: null,
          creatorName: null,
          platform: item.target.platform,
          sourceUrl: item.target.canonicalUrl,
          state: "UNAVAILABLE",
          lorebookCount: 0,
          greetingCount: 0,
          error: item.error ?? `Item status: ${item.status}`,
        });
        continue;
      }

      const character = item.character;
      lorebooksDiscovered += character.lorebookReferences.length;

      let duplicateAnalysis: DuplicateAnalysis | undefined;
      try {
        duplicateAnalysis = await this.duplicateAnalyzer(character);
      } catch (caught) {
        rejectedCount++;
        previews.push({
          index,
          externalId: character.externalId,
          name: character.name,
          avatarUrl: character.avatarUrl,
          creatorName: character.creator.name,
          platform: character.platform,
          sourceUrl: character.sourceUrl,
          state: "REJECTED",
          lorebookCount: character.lorebookReferences.length,
          greetingCount: character.greetings.length,
          error: caught instanceof Error ? caught.message : "Duplicate analysis failed.",
        });
        continue;
      }

      let state: BatchItemState = "NEW";
      if (duplicateAnalysis.classification === "EXACT_SOURCE") {
        state = "EXACT_EXISTING";
        exactExistingCount++;
      } else if (
        duplicateAnalysis.classification === "STRONG_CROSS_SOURCE_CANDIDATE" ||
        duplicateAnalysis.classification === "POSSIBLE_DUPLICATE"
      ) {
        state = "REVIEW_REQUIRED";
        reviewRequiredCount++;
      } else {
        state = "NEW";
        newCount++;
      }

      previews.push({
        index,
        externalId: character.externalId,
        name: character.name,
        avatarUrl: character.avatarUrl,
        creatorName: character.creator.name,
        platform: character.platform,
        sourceUrl: character.sourceUrl,
        state,
        duplicateAnalysis,
        lorebookCount: character.lorebookReferences.length,
        greetingCount: character.greetings.length,
      });
    }

    return {
      totalFound: items.length,
      newCount,
      exactExistingCount,
      reviewRequiredCount,
      rejectedCount,
      unavailableCount,
      lorebooksDiscovered,
      items: previews,
    };
  }
}

export const defaultSourceOrchestrator = new SourceRetrievalOrchestrator();

function normalizedParseError(
  platform: SourceTarget["platform"],
  code: string,
): SourceRetrievalError {
  if (code === "UNSUPPORTED_HOST" || code === "UNKNOWN_TARGET_TYPE") {
    return new SourceRetrievalError(platform, "UNSUPPORTED_SOURCE", "This source is not supported for Single Retrieve.");
  }
  return new SourceRetrievalError(platform, "INVALID_URL", "Enter a valid supported character URL.");
}

function normalizedRetrievalError(
  platform: SourceTarget["platform"],
  result: RetrievedCharacterResult,
): SourceRetrievalError {
  if (result.status === "NOT_FOUND") {
    return new SourceRetrievalError(platform, "NOT_FOUND", "The source character was not found.");
  }
  if (result.status === "RATE_LIMITED") {
    return new SourceRetrievalError(platform, "RATE_LIMITED", "The source rate-limited this request. Try again shortly.");
  }
  if (result.status === "MALFORMED") {
    return new SourceRetrievalError(platform, "INVALID_SOURCE_PAYLOAD", "The source returned an invalid character payload.");
  }
  if (result.status === "UNSUPPORTED") {
    return new SourceRetrievalError(platform, "UNSUPPORTED_SOURCE", "This source is not supported for Single Retrieve.");
  }
  if (result.timedOut) {
    return new SourceRetrievalError(platform, "RETRIEVAL_TIMEOUT", "The source retrieval timed out.");
  }
  return new SourceRetrievalError(platform, "SOURCE_UNAVAILABLE", "The source is temporarily unavailable.");
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, delayMs);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timeout);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
