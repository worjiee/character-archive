import type { SourceAdapter } from "./adapter";
import { JanitorSourceAdapter } from "./janitor-adapter";
import type {
  ParseTargetResult,
  RetrievedCharacterResult,
  SourceCapabilities,
  SourcePlatformIdentity,
  SourceTarget,
  SourceSupportState,
} from "./types";
import { normalizeUuidPrefix } from "../source-identifiers";

class FuturePlaceholderAdapter implements SourceAdapter {
  readonly platform: SourcePlatformIdentity;
  readonly capabilities: SourceCapabilities;

  constructor(platform: SourcePlatformIdentity, persisted: boolean) {
    this.platform = platform;
    this.capabilities = {
      singleCharacter: false,
      creatorProfile: false,
      lorebooks: false,
      sourceTimestamps: false,
      authenticatedRetrieval: false,
      publicRetrieval: false,
      persistedPlatform: persisted,
    };
  }

  parseTarget(input: string): ParseTargetResult {
    let parsed: URL;
    try { parsed = new URL(input.trim()); } catch { return { success: false, error: "Invalid URL string provided.", code: "INVALID_URL" }; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { success: false, error: "Only HTTP and HTTPS source URLs are supported.", code: "UNSUPPORTED_SCHEME" };
    if (parsed.username || parsed.password) return { success: false, error: "URLs containing embedded credentials are strictly rejected.", code: "EMBEDDED_CREDENTIALS" };
    const segments = parsed.pathname.split("/").filter(Boolean);
    const externalId = this.platform === "SAUCEPAN"
      ? segments[0] === "companion" && segments.length === 2 ? normalizeUuidPrefix(segments[1]) : null
      : segments[0] === "characters" ? segments.map(normalizeUuidPrefix).findLast(Boolean) ?? null : null;
    if (!externalId) return { success: false, error: `This ${this.platform} URL is not a recognized character link.`, code: "MALFORMED_TARGET" };
    return {
      success: true,
      target: {
        platform: this.platform,
        importProvider: this.platform,
        originalPlatform: this.platform === "DATACAT" ? null : "SAUCEPAN",
        type: "CHARACTER",
        externalId,
        canonicalUrl: parsed.toString(),
        rawInput: input.trim(),
      },
    };
  }

  async retrieveCharacter(target: SourceTarget): Promise<RetrievedCharacterResult> {
    return {
      status: "UNSUPPORTED",
      target,
      error: `Retrieval for platform ${this.platform} is not implemented.`,
    };
  }
}

export class SourceAdapterRegistry {
  private readonly adapters = new Map<SourcePlatformIdentity, SourceAdapter>();

  constructor() {
    this.registerAdapter(new JanitorSourceAdapter());
    this.registerAdapter(new FuturePlaceholderAdapter("SAUCEPAN", true));
    this.registerAdapter(new FuturePlaceholderAdapter("DATACAT", true));
    this.registerAdapter(new FuturePlaceholderAdapter("JANNY", false)); // Janny is NOT persisted in Prisma
  }

  registerAdapter(adapter: SourceAdapter): void {
    this.adapters.set(adapter.platform, adapter);
  }

  getAdapter(platform: SourcePlatformIdentity): SourceAdapter | undefined {
    return this.adapters.get(platform);
  }

  getCapabilities(platform: SourcePlatformIdentity): SourceCapabilities | undefined {
    return this.getAdapter(platform)?.capabilities;
  }

  supportState(result: ParseTargetResult): SourceSupportState {
    if (!result.success) return "UNSUPPORTED";
    const provider = result.target.importProvider ?? result.target.platform;
    if (provider === "DATACAT") return "RECOGNIZED_PENDING_CAPABILITY";
    return this.getCapabilities(provider)?.singleCharacter ? "AVAILABLE" : "RECOGNIZED_UNAVAILABLE";
  }

  getAllAdapters(): SourceAdapter[] {
    return [...this.adapters.values()];
  }

  resolveTarget(input: string): ParseTargetResult {
    const trimmed = input.trim();
    if (!trimmed) {
      return {
        success: false,
        error: "Target input cannot be empty.",
        code: "INVALID_URL",
      };
    }

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return {
        success: false,
        error: "Invalid URL string provided.",
        code: "INVALID_URL",
      };
    }

    const host = url.hostname.toLowerCase();
    const hostPlatform: Record<string, SourcePlatformIdentity> = {
      "janitorai.com": "JANITOR_AI",
      "www.janitorai.com": "JANITOR_AI",
      "datacat.run": "DATACAT",
      "www.datacat.run": "DATACAT",
      "saucepan.ai": "SAUCEPAN",
      "www.saucepan.ai": "SAUCEPAN",
    };
    const platform = hostPlatform[host];
    if (platform) {
      const adapter = this.getAdapter(platform);
      return adapter ? adapter.parseTarget(trimmed) : { success: false, error: "Source adapter not registered.", code: "UNSUPPORTED_HOST" };
    }

    return {
      success: false,
      error: `No registered source adapter supports host "${url.hostname}".`,
      code: "UNSUPPORTED_HOST",
    };
  }
}

export const defaultSourceRegistry = new SourceAdapterRegistry();
