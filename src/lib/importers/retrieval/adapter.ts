import type {
  BatchProfilePage,
  ParseTargetResult,
  RetrievalOptions,
  RetrievedCharacterResult,
  RetrievedLorebookResult,
  SourceCapabilities,
  SourcePlatformIdentity,
  SourceTarget,
} from "./types";

export interface SourceAdapter {
  readonly platform: SourcePlatformIdentity;
  readonly capabilities: SourceCapabilities;
  parseTarget(input: string): ParseTargetResult;
  retrieveCharacter(
    target: SourceTarget,
    options?: RetrievalOptions,
  ): Promise<RetrievedCharacterResult>;
  retrieveProfilePage?(
    target: SourceTarget,
    page: number,
    pageSize: number,
    options?: RetrievalOptions,
  ): Promise<BatchProfilePage>;
  retrieveLorebook?(
    target: SourceTarget,
    options?: RetrievalOptions,
  ): Promise<RetrievedLorebookResult>;
}

export class SourceRetrievalError extends Error {
  readonly platform: SourcePlatformIdentity;
  readonly code: string;

  constructor(platform: SourcePlatformIdentity, code: string, message: string) {
    super(message);
    this.name = "SourceRetrievalError";
    this.platform = platform;
    this.code = code;
  }
}
