import { describe, expect, it } from "vitest";
import {
  isDevelopmentFixtureLorebookIdentity,
  PROTECTED_REAL_LOREBOOK_EXTERNAL_IDS,
} from "./fixture-identities";

describe("development fixture identities", () => {
  it("recognizes the explicit synthetic lorebook identity", () => {
    expect(
      isDevelopmentFixtureLorebookIdentity({
        platform: "JANITOR_AI",
        externalId: "fixture-lore-dku",
      }),
    ).toBe(true);
  });

  it.each(PROTECTED_REAL_LOREBOOK_EXTERNAL_IDS)(
    "does not classify protected real UUID %s as a fixture",
    (externalId) => {
      expect(
        isDevelopmentFixtureLorebookIdentity({
          platform: "JANITOR_AI",
          externalId,
        }),
      ).toBe(false);
    },
  );

  it("does not use a same or similar title as fixture identity", () => {
    const realLorebookWithSameTitle = {
      platform: "JANITOR_AI" as const,
      externalId: "adb43eef-53a0-4e26-a0fd-8d20a8544fbc",
      title: "DKU Locations & Clubs",
    };

    expect(isDevelopmentFixtureLorebookIdentity(realLorebookWithSameTitle)).toBe(false);
  });
});
