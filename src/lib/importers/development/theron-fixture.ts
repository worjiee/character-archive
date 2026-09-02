import type { JanitorCharacterResponse } from "../janitor";
import {
  DKU_LOCATIONS_LOREBOOK_ID,
  DKU_LOCATIONS_LOREBOOK_TITLE,
} from "./dku-locations-lorebook-fixture";

export const THERON_CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";

export const THERON_CHARACTER_URL =
  "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron-dku-edition";

export const theronFixture: JanitorCharacterResponse = {
  id: THERON_CHARACTER_ID,
  name: "Theron — DKU Edition",
  description:
    "A guarded warrior caught between duty and the dangerous pull of an unexpected alliance.",
  personality:
    "Disciplined, observant, dryly funny, and slow to trust. Theron protects the people he accepts as his own.",
  scenario:
    "You meet Theron at the edge of a ruined keep while both searching for answers about the same vanished expedition.",
  example_dialogs: "{{char}}: Keep your voice down. We are not alone here.",
  avatar: "/theron-placeholder.svg",
  creator_id: "dku-development-fixture",
  creator_name: "DKU",
  is_public: true,
  is_deleted: false,
  first_message:
    "Theron lowers his blade, but not his guard. \"You have ten seconds to tell me why you're here.\"",
  first_messages: [
    "Theron lowers his blade, but not his guard. \"You have ten seconds to tell me why you're here.\"",
    "Rain runs from Theron's cloak as he studies the broken seal. \"This was opened from the inside.\"",
  ],
  tags: [
    { id: "fixture-tag-fantasy", name: "Fantasy", slug: "fantasy" },
    { id: "fixture-tag-male", name: "Male", slug: "male" },
    { id: "fixture-tag-adventure", name: "Adventure", slug: "adventure" },
  ],
  custom_tags: ["#Epic Fantasy", "Slow Burn"],
  scripts: [
    { id: DKU_LOCATIONS_LOREBOOK_ID, type: "lorebook", title: DKU_LOCATIONS_LOREBOOK_TITLE },
    { id: "fixture-script-ignored", type: "other", title: "Not a lorebook" },
  ],
  created_at: "2025-01-15T10:30:00.000Z",
  updated_at: "2025-06-20T14:00:00.000Z",
  fixture_origin: "sanitized reference-derived structure with synthetic prose",
  fixture_version: 1,
};
