import type { SourceAdapter } from "./adapter";
import { JanitorSourceAdapter } from "./janitor-adapter";
import type {
  ParseTargetResult,
  RetrievedCharacterResult,
  SourceCapabilities,
  SourcePlatformIdentity,
  SourceTarget,
} from "./types";

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
    void input;
    return {
      success: false,
      error: `Adapter for platform ${this.platform} is registered as future / under development.`,
      code: "UNSUPPORTED_HOST",
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
    if (host === "janitorai.com" || host === "www.janitorai.com") {
      const adapter = this.getAdapter("JANITOR_AI");
      return adapter ? adapter.parseTarget(trimmed) : { success: false, error: "Janitor adapter not registered.", code: "UNSUPPORTED_HOST" };
    }

    return {
      success: false,
      error: `No registered source adapter supports host "${url.hostname}".`,
      code: "UNSUPPORTED_HOST",
    };
  }
}

export const defaultSourceRegistry = new SourceAdapterRegistry();
