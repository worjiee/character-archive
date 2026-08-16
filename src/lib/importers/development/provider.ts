import type { NormalizedCharacter, NormalizedLorebook } from "../types";
import {
  normalizeJanitorCharacter,
  normalizeJanitorLorebook,
  parseJanitorCharacterUrl,
} from "../janitor";
import {
  THERON_CHARACTER_ID,
  theronFixture,
} from "./theron-fixture";
import {
  DKU_LOCATIONS_LOREBOOK_ID,
  DKU_LOCATIONS_LOREBOOK_TITLE,
  DKU_LOCATIONS_LOREBOOK_URL,
  dkuLocationsLorebookFixture,
} from "./dku-locations-lorebook-fixture";

export type DevelopmentFixtureErrorCode =
  | "FIXTURE_DISABLED"
  | "FIXTURE_UNAVAILABLE";

export class DevelopmentFixtureError extends Error {
  readonly code: DevelopmentFixtureErrorCode;

  constructor(code: DevelopmentFixtureErrorCode, message: string) {
    super(message);
    this.name = "DevelopmentFixtureError";
    this.code = code;
  }
}

export async function loadDevelopmentJanitorCharacter(
  sourceUrl: string,
): Promise<NormalizedCharacter> {
  if (process.env.NODE_ENV === "production") {
    throw new DevelopmentFixtureError(
      "FIXTURE_DISABLED",
      "The development fixture provider is disabled in production.",
    );
  }

  const characterId = parseJanitorCharacterUrl(sourceUrl);

  if (characterId !== THERON_CHARACTER_ID) {
    throw new DevelopmentFixtureError(
      "FIXTURE_UNAVAILABLE",
      "No development fixture is available for that Janitor AI character.",
    );
  }

  return normalizeJanitorCharacter(theronFixture, sourceUrl);
}

export async function loadDevelopmentJanitorLorebook(
  externalId: string,
): Promise<NormalizedLorebook> {
  if (process.env.NODE_ENV === "production") {
    throw new DevelopmentFixtureError(
      "FIXTURE_DISABLED",
      "The development fixture provider is disabled in production.",
    );
  }
  if (externalId !== DKU_LOCATIONS_LOREBOOK_ID) {
    throw new DevelopmentFixtureError(
      "FIXTURE_UNAVAILABLE",
      "No development lorebook fixture is available for that reference.",
    );
  }
  return normalizeJanitorLorebook(dkuLocationsLorebookFixture, {
    externalId: DKU_LOCATIONS_LOREBOOK_ID,
    title: DKU_LOCATIONS_LOREBOOK_TITLE,
    description: "Synthetic development fixture for open-lorebook import testing.",
    sourceUrl: DKU_LOCATIONS_LOREBOOK_URL,
  });
}
