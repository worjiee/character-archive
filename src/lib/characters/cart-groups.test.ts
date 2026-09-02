import { describe, expect, it } from "vitest";
import type { CharacterCardItem } from "./browse";
import { groupCartCharacters, resolveCartAuthor } from "./cart-groups";

describe("Cart author grouping", () => {
  it("uses platform plus external creator ID and sorts authors alphabetically with unknown last", () => {
    const groups = groupCartCharacters([
      card("3", "Third", [{ platform: "DATACAT", creatorName: null }]),
      card("2", "Second", [{ platform: "SAUCEPAN", creatorName: "Alpha", externalCreatorId: "same-name-b" }]),
      card("1", "First", [{ platform: "JANITOR_AI", creatorName: "Alpha", externalCreatorId: "same-name-a" }]),
    ]);

    expect(groups.map(({ name, platform, characterIds }) => ({ name, platform, characterIds }))).toEqual([
      { name: "Alpha", platform: "JANITOR_AI", characterIds: ["1"] },
      { name: "Alpha", platform: "SAUCEPAN", characterIds: ["2"] },
      { name: "Unknown author", platform: null, characterIds: ["3"] },
    ]);
  });

  it("chooses the earliest usable source and never groups only by display name across platforms", () => {
    const author = resolveCartAuthor([
      { platform: "JANITOR_AI", creatorName: null, externalCreatorId: null },
      { platform: "SAUCEPAN", creatorName: "Creator", externalCreatorId: "creator-9" },
      { platform: "DATACAT", creatorName: "Later", externalCreatorId: "creator-10" },
    ]);
    expect(author).toMatchObject({
      key: "source:SAUCEPAN:creator:creator-9",
      name: "Creator",
      platform: "SAUCEPAN",
    });
  });

  it("sorts characters by display name and places a character in exactly one group", () => {
    const groups = groupCartCharacters([
      card("b", "Zulu", [{ platform: "JANITOR_AI", creatorName: "Creator", externalCreatorId: "creator" }]),
      card("a", "Alpha", [
        { platform: "JANITOR_AI", creatorName: "Creator", externalCreatorId: "creator" },
        { platform: "DATACAT", creatorName: "Another", externalCreatorId: "another" },
      ]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.characterIds).toEqual(["a", "b"]);
  });

  it("keeps mixed realistic Cart fixtures bounded and countable", () => {
    const characters = Array.from({ length: 50 }, (_, index) => card(
      `character-${index}`,
      `Bot ${index}`,
      [{
        platform: index % 2 === 0 ? "JANITOR_AI" : "DATACAT",
        creatorName: `Author ${index % 20}`,
        externalCreatorId: `creator-${index % 20}`,
      }],
    ));
    const groups = groupCartCharacters(characters);
    expect(groups).toHaveLength(20);
    expect(groups.reduce((total, group) => total + group.characterIds.length, 0)).toBe(50);
    expect(new Set(groups.flatMap(({ characterIds }) => characterIds)).size).toBe(50);
  });
});

function card(id: string, name: string, sources: CharacterCardItem["sources"]): CharacterCardItem {
  return { id, name, avatarUrl: null, status: "ACTIVE", sources, tags: [] };
}
