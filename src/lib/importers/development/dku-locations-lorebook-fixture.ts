import type { JanitorLorebookSource } from "../janitor";

export const DKU_LOCATIONS_LOREBOOK_ID = "fixture-lore-dku";
export const DKU_LOCATIONS_LOREBOOK_TITLE = "DKU Locations & Clubs";
export const DKU_LOCATIONS_LOREBOOK_URL =
  "https://janitorai.com/lorebooks/fixture-lore-dku_dku-locations-and-clubs";

// Synthetic development content shaped like the observed public source JSON.
export const dkuLocationsLorebookFixture: JanitorLorebookSource = [
  {
    id: 101,
    content: "The Lantern Room is a quiet café near the east campus gate.",
    key: ["Lantern Room", "east gate", " café "],
    category: "Locations",
    comment: "East campus meeting spot",
    enabled: true,
    constant: false,
    insertion_order: 10,
    case_sensitive: false,
    activationMode: "keyword",
    activationScript: null,
    groupWeight: 80,
    inclusionGroupRaw: "campus-venues",
    keyMatchPriority: 2,
    extensions: { fixture: true },
  },
  {
    id: "club-archive",
    content: "The Archive Club meets weekly to catalogue unusual local stories.",
    key: ["Archive Club", "archive club", "Archive Club"],
    category: "Clubs",
    comment: "Student organization",
    enabled: true,
    constant: false,
    insertion_order: 20,
    case_sensitive: false,
    activationMode: "keyword",
    groupWeight: 60,
    extensions: { color: "violet" },
  },
  {
    id: "central-quad",
    content: "The central quad connects the library, hall, and student center.",
    key: ["central quad", "student center"],
    category: "Locations",
    enabled: false,
    constant: true,
    insertion_order: 30,
    case_sensitive: null,
    activationMode: "constant",
    activationScript: "return context.isOnCampus;",
    groupWeight: 100,
    extensions: { fixture: true, version: 1 },
  },
];
