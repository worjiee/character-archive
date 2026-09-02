import type { NormalizedCharacter, NormalizedLorebook } from "./types";
import {
  loadDevelopmentJanitorCharacter,
  loadDevelopmentJanitorLorebook,
  isDevelopmentFixtureEnabled,
  THERON_CHARACTER_ID,
} from "./development";
import { normalizeManualJanitorCharacter } from "./janitor";
import {
  persistNormalizedCharacter,
  persistNormalizedLorebook,
  type PersistNormalizedCharacterOptions,
  type PersistNormalizedCharacterResult,
  type PersistNormalizedLorebookResult,
} from "./persistence";

import {
  SourceRetrievalOrchestrator,
  defaultSourceOrchestrator,
  type RetrievalMode,
} from "./retrieval";

import {
  analyzeDuplicates,
  type DuplicateAnalysis,
} from "./duplicate-detector";
import type { ModerationResult } from "../moderation/matcher";
import type { AuthenticatedPrincipal } from "../auth";
import type { SafeArtworkPreview } from "../artwork/types";

export interface ImportPreview {
  externalId: string;
  platform: NormalizedCharacter["platform"];
  sourceUrl: string;
  name: string;
  description: string | null;
  personality: string | null;
  scenario: string | null;
  avatarUrl: string | null;
  creator: NormalizedCharacter["creator"];
  greetings: NormalizedCharacter["greetings"];
  tags: NormalizedCharacter["tags"];
  lorebookReferences: NormalizedCharacter["lorebookReferences"];
  artwork?: SafeArtworkPreview;
  provider: "development-fixture" | "manual-json" | "automatic-url" | "browser-bridge" | "artifact-upload";
  duplicateAnalysis?: DuplicateAnalysis;
  moderation?: ModerationResult;
}
export type DevelopmentCharacterLoader = (
  sourceUrl: string,
) => Promise<NormalizedCharacter>;

export interface DevelopmentImportSaveResult extends PersistNormalizedCharacterResult {
  lorebooks: PersistNormalizedLorebookResult[];
}

export type DevelopmentLorebookLoader = (externalId: string) => Promise<NormalizedLorebook>;
export type DevelopmentLorebookPersister = (
  lorebook: NormalizedLorebook,
  options: { characterId: string },
) => Promise<PersistNormalizedLorebookResult>;

export function toImportPreview(
  character: NormalizedCharacter,
  provider: ImportPreview["provider"] = "development-fixture",
  duplicateAnalysis?: DuplicateAnalysis,
): ImportPreview {
  return {
    externalId: character.externalId,
    platform: character.platform,
    sourceUrl: character.sourceUrl,
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    avatarUrl: character.avatarUrl,
    creator: character.creator,
    greetings: character.greetings,
    tags: character.tags,
    lorebookReferences: character.lorebookReferences,
    provider,
    ...(duplicateAnalysis ? { duplicateAnalysis } : {}),
  };
}

export async function previewManualCharacter(
  sourceUrl: string,
  sourceJson: string,
  dependencies: {
    analyze?: (character: NormalizedCharacter) => Promise<DuplicateAnalysis>;
  } = {},
): Promise<ImportPreview> {
  const character = normalizeManualJanitorCharacter(sourceUrl, sourceJson);
  const duplicateAnalysis = await (dependencies.analyze ?? analyzeDuplicates)(character);
  return toImportPreview(character, "manual-json", duplicateAnalysis);
}

export async function saveManualCharacter(
  sourceUrl: string,
  sourceJson: string,
  options: {
    principal: AuthenticatedPrincipal;
    persist?: (
      character: NormalizedCharacter,
      options: PersistNormalizedCharacterOptions,
    ) => Promise<PersistNormalizedCharacterResult>;
    targetCharacterId?: string;
  },
): Promise<PersistNormalizedCharacterResult> {
  const character = normalizeManualJanitorCharacter(sourceUrl, sourceJson);
  const persist = options.persist ?? persistNormalizedCharacter;

  return persist(character, {
    principal: options.principal,
    targetCharacterId: options.targetCharacterId,
  });
}

export async function previewDevelopmentCharacter(
  sourceUrl: string,
  dependencies:
    | DevelopmentCharacterLoader
    | {
        load?: DevelopmentCharacterLoader;
        analyze?: (character: NormalizedCharacter) => Promise<DuplicateAnalysis>;
      } = {},
): Promise<ImportPreview> {
  assertDevelopmentFixtureWorkflowEnabled();
  const load =
    typeof dependencies === "function"
      ? dependencies
      : dependencies.load ?? loadDevelopmentJanitorCharacter;
  const analyze =
    typeof dependencies === "function"
      ? undefined
      : dependencies.analyze;
  const character = await load(sourceUrl);
  const duplicateAnalysis = analyze
    ? await analyze(character)
    : await analyzeDuplicates(character);
  return toImportPreview(character, "development-fixture", duplicateAnalysis);
}

export async function saveDevelopmentCharacter(
  sourceUrl: string,
  dependencies: {
    principal: AuthenticatedPrincipal;
    load?: DevelopmentCharacterLoader;
    persist?: (
      character: NormalizedCharacter,
      options: PersistNormalizedCharacterOptions,
    ) => Promise<PersistNormalizedCharacterResult>;
    loadLorebook?: DevelopmentLorebookLoader;
    persistLorebook?: DevelopmentLorebookPersister;
    targetCharacterId?: string;
  },
): Promise<DevelopmentImportSaveResult> {
  assertDevelopmentFixtureWorkflowEnabled();
  const character = await (dependencies.load ?? loadDevelopmentJanitorCharacter)(sourceUrl);
  const persist = dependencies.persist ?? persistNormalizedCharacter;
  const persistedCharacter = await persist(character, {
    principal: dependencies.principal,
    targetCharacterId: dependencies.targetCharacterId,
  });
  const lorebooks: PersistNormalizedLorebookResult[] = [];

  if (character.externalId === THERON_CHARACTER_ID) {
    for (const reference of character.lorebookReferences) {
      const normalizedLorebook = await (
        dependencies.loadLorebook ?? loadDevelopmentJanitorLorebook
      )(reference.externalId);
      lorebooks.push(
        await (dependencies.persistLorebook ?? persistNormalizedLorebook)(
          normalizedLorebook,
          { characterId: persistedCharacter.characterId },
        ),
      );
    }
  }

  return { ...persistedCharacter, lorebooks };
}

function assertDevelopmentFixtureWorkflowEnabled(): void {
  if (!isDevelopmentFixtureEnabled()) {
    throw new Error("Development fixture workflows are disabled in production.");
  }
}

export async function previewRetrievedCharacter(
  sourceUrl: string,
  dependencies: {
    orchestrator?: SourceRetrievalOrchestrator;
    retrieve?: (sourceUrl: string) => Promise<NormalizedCharacter>;
    analyze?: (character: NormalizedCharacter) => Promise<DuplicateAnalysis>;
    mode?: RetrievalMode;
  },
): Promise<ImportPreview> {
  let character: NormalizedCharacter;
  let duplicateAnalysis: DuplicateAnalysis;

  if (dependencies.retrieve) {
    character = await dependencies.retrieve(sourceUrl);
    duplicateAnalysis = await (dependencies.analyze ?? analyzeDuplicates)(character);
  } else {
    const orchestrator =
      dependencies.orchestrator ??
      (dependencies.analyze
        ? new SourceRetrievalOrchestrator({ analyzeDuplicates: dependencies.analyze })
        : defaultSourceOrchestrator);
    const result = await orchestrator.previewSingle(sourceUrl, {
      mode: dependencies.mode ?? "PUBLIC_ONLY",
    });
    character = result.character;
    duplicateAnalysis = result.duplicateAnalysis;
  }

  return toImportPreview(character, "automatic-url", duplicateAnalysis);
}
