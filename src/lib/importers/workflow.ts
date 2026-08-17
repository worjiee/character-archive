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
  type PersistNormalizedCharacterResult,
  type PersistNormalizedLorebookResult,
} from "./persistence";

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
  };
}

export function previewManualCharacter(sourceUrl: string, sourceJson: string): ImportPreview {
  return toImportPreview(normalizeManualJanitorCharacter(sourceUrl, sourceJson), "manual-json");
}

export async function saveManualCharacter(
  sourceUrl: string,
  sourceJson: string,
  persist: (
    character: NormalizedCharacter,
  ) => Promise<PersistNormalizedCharacterResult> = persistNormalizedCharacter,
): Promise<PersistNormalizedCharacterResult> {
  const character = normalizeManualJanitorCharacter(sourceUrl, sourceJson);
  return persist(character);
}

export async function previewDevelopmentCharacter(
  sourceUrl: string,
  load: DevelopmentCharacterLoader = loadDevelopmentJanitorCharacter,
): Promise<ImportPreview> {
  return toImportPreview(await load(sourceUrl));
}

export async function saveDevelopmentCharacter(
  sourceUrl: string,
  dependencies: {
    load?: DevelopmentCharacterLoader;
    persist?: (
      character: NormalizedCharacter,
    ) => Promise<PersistNormalizedCharacterResult>;
    loadLorebook?: DevelopmentLorebookLoader;
    persistLorebook?: DevelopmentLorebookPersister;
  } = {},
): Promise<DevelopmentImportSaveResult> {
  const character = await (dependencies.load ?? loadDevelopmentJanitorCharacter)(sourceUrl);
  const persistedCharacter = await (dependencies.persist ?? persistNormalizedCharacter)(character);
  const lorebooks: PersistNormalizedLorebookResult[] = [];

  if (character.externalId === THERON_CHARACTER_ID) {
    for (const reference of character.lorebookReferences) {
      const normalizedLorebook = await (
        dependencies.loadLorebook ?? loadDevelopmentJanitorLorebook
      )(reference.externalId);
      lorebooks.push(await (
        dependencies.persistLorebook ?? persistNormalizedLorebook
      )(normalizedLorebook, { characterId: persistedCharacter.characterId }));
    }
  }

  return { ...persistedCharacter, lorebooks };
}
