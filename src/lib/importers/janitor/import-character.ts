import type { NormalizedCharacter } from "../types";
import {
  fetchJanitorCharacter,
  type FetchJanitorCharacterOptions,
} from "./fetch-character";
import { normalizeJanitorCharacter } from "./normalize";
import { parseJanitorCharacterUrl } from "./parse-url";

export type ImportJanitorCharacterOptions = FetchJanitorCharacterOptions;

export async function importJanitorCharacter(
  url: string,
  options: ImportJanitorCharacterOptions = {},
): Promise<NormalizedCharacter> {
  const characterId = parseJanitorCharacterUrl(url);
  const source = await fetchJanitorCharacter(characterId, options);
  return normalizeJanitorCharacter(source, url);
}
