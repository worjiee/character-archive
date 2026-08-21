import type { NormalizedCharacter, NormalizedLorebook } from "./types";
import {
  loadDevelopmentJanitorCharacter,
  loadDevelopmentJanitorLorebook,
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
  analyzeDuplicates,
  type DuplicateAnalysis,
} from "./duplicate-detector";

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
  provider: "development-fixture" | "manual-json";
  duplicateAnalysis?: DuplicateAnalysis;
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
  persistOrOptions:
    | ((
        character: NormalizedCharacter,
        options?: PersistNormalizedCharacterOptions,
      ) => Promise<PersistNormalizedCharacterResult>)
    | {
        persist?: (
          character: NormalizedCharacter,
          options?: PersistNormalizedCharacterOptions,
        ) => Promise<PersistNormalizedCharacterResult>;
        targetCharacterId?: string;
      } = {},
): Promise<PersistNormalizedCharacterResult> {
  const character = normalizeManualJanitorCharacter(sourceUrl, sourceJson);
  const persist =
    typeof persistOrOptions === "function"
      ? persistOrOptions
      : persistOrOptions.persist ?? persistNormalizedCharacter;
  const targetCharacterId =
    typeof persistOrOptions === "function"
      ? undefined
      : persistOrOptions.targetCharacterId;

  return persist(character, { targetCharacterId });
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
    load?: DevelopmentCharacterLoader;
    persist?: (
      character: NormalizedCharacter,
      options?: PersistNormalizedCharacterOptions,
    ) => Promise<PersistNormalizedCharacterResult>;
    loadLorebook?: DevelopmentLorebookLoader;
    persistLorebook?: DevelopmentLorebookPersister;
    targetCharacterId?: string;
  } = {},
): Promise<DevelopmentImportSaveResult> {
  const character = await (dependencies.load ?? loadDevelopmentJanitorCharacter)(sourceUrl);
  const persist = dependencies.persist ?? persistNormalizedCharacter;
  const persistedCharacter = await persist(character, {
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
