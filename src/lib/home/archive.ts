import type {
  CharacterBrowseFacets,
  CharacterBrowseResult,
} from "../characters/browse";
import {
  browseCharacters,
  getCharacterBrowseFacets,
} from "../characters/browse";
import type { LorebookBrowseResult } from "../lorebooks/browse";
import { browseLorebooks } from "../lorebooks/browse";

export const HOME_CHARACTER_LIMIT = 10;
export const HOME_LOREBOOK_LIMIT = 6;

export interface HomeArchiveData {
  characters: CharacterBrowseResult;
  characterFacets: CharacterBrowseFacets;
  lorebooks: LorebookBrowseResult;
}

interface HomeArchiveServices {
  browseCharacters: typeof browseCharacters;
  getCharacterBrowseFacets: typeof getCharacterBrowseFacets;
  browseLorebooks: typeof browseLorebooks;
}

const defaultServices: HomeArchiveServices = {
  browseCharacters,
  getCharacterBrowseFacets,
  browseLorebooks,
};

export async function getHomeArchiveData(
  services: HomeArchiveServices = defaultServices,
): Promise<HomeArchiveData> {
  const [characters, characterFacets, lorebooks] = await Promise.all([
    services.browseCharacters({
      query: "",
      sources: [],
      tags: [],
      statuses: [],
      sort: "updated",
      page: 1,
      pageSize: HOME_CHARACTER_LIMIT,
    }),
    services.getCharacterBrowseFacets(),
    services.browseLorebooks({
      query: "",
      sources: [],
      sort: "updated",
      page: 1,
      pageSize: HOME_LOREBOOK_LIMIT,
    }),
  ]);

  return { characters, characterFacets, lorebooks };
}
