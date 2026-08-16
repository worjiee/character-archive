import { describe, expect, it } from "vitest";
import {
  DevelopmentFixtureError,
  DKU_LOCATIONS_LOREBOOK_ID,
  loadDevelopmentJanitorCharacter,
  loadDevelopmentJanitorLorebook,
  THERON_CHARACTER_URL,
} from "./index";

describe("development Janitor provider", () => {
  it("normalizes the Theron fixture after real URL validation", async () => {
    const character = await loadDevelopmentJanitorCharacter(THERON_CHARACTER_URL);

    expect(character.name).toContain("Theron");
    expect(character.externalId).toBe("d7745ac8-8b75-48ec-aaf9-5699ad547cd7");
    expect(character.greetings).toHaveLength(2);
  });

  it("normalizes the synthetic open-lorebook fixture", async () => {
    const lorebook = await loadDevelopmentJanitorLorebook(DKU_LOCATIONS_LOREBOOK_ID);
    expect(lorebook.title).toBe("DKU Locations & Clubs");
    expect(lorebook.entries).toHaveLength(3);
    expect(lorebook.entries.map((entry) => entry.externalEntryId)).toEqual([
      "101",
      "club-archive",
      "central-quad",
    ]);
  });

  it("rejects malformed Janitor URLs", async () => {
    await expect(loadDevelopmentJanitorCharacter("https://example.com/characters/nope"))
      .rejects.toBeInstanceOf(TypeError);
  });

  it("reports a valid character without a fixture", async () => {
    await expect(
      loadDevelopmentJanitorCharacter(
        "https://janitorai.com/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80_other",
      ),
    ).rejects.toMatchObject({
      code: "FIXTURE_UNAVAILABLE",
    } satisfies Partial<DevelopmentFixtureError>);
  });
});
