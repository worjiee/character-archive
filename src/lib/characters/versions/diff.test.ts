import { describe, expect, it } from "vitest";
import { compareCharacterSnapshots } from "./diff";
import { buildCanonicalCharacterSnapshot } from "./snapshot";

describe("Character Version Diff Engine", () => {
  const baseData = {
    name: "Aria Thorne",
    description: "A mysterious guard.",
    personality: "Loyal, stoic.",
    scenario: "Palace courtyard.",
    exampleDialogs: "Halt!",
    systemPrompt: "Literary style.",
    postHistoryInstructions: "Stay in character.",
    avatarUrl: "https://example.com/aria.png",
    artworkSha256: "sha-111",
    tokenCount: 2813,
    permanentTokenCount: 2420,
    greetings: [
      { content: "Greeting 1", position: 0, hidden: false },
      { content: "Greeting 2", position: 1, hidden: false },
    ],
    tags: [
      { name: "Fantasy", slug: "fantasy" },
      { name: "Angst", slug: "angst" },
    ],
    lorebooks: [
      {
        externalId: "lb-1",
        title: "Citadel Lore",
        description: "Lore text",
        sourcePlatform: "JANITOR_AI",
        sourceUrl: "https://example.com/lb1",
        entries: [
          {
            externalEntryId: "e-1",
            content: "Guard lore",
            keys: ["guard"],
            enabled: true,
            constant: false,
            insertionOrder: 0,
          },
        ],
      },
    ],
    sources: [
      {
        platform: "JANITOR_AI",
        externalId: "aria-1",
        sourceUrl: "https://example.com/aria-1",
      },
    ],
  };

  it("reports hasChanges=false when comparing identical snapshots", () => {
    const s1 = buildCanonicalCharacterSnapshot(baseData);
    const s2 = buildCanonicalCharacterSnapshot(baseData);
    const diff = compareCharacterSnapshots(s1, s2, { fromVersion: 1, toVersion: 2 });
    expect(diff.hasChanges).toBe(false);
    expect(diff.changedFieldCount).toBe(0);
    expect(diff.fields.name.changed).toBe(false);
    expect(diff.tokens.tokenDelta).toBe(0);
    expect(diff.artwork.changed).toBe(false);
    expect(diff.greetings.changed).toBe(false);
    expect(diff.tags.changed).toBe(false);
    expect(diff.lorebooks.changed).toBe(false);
  });

  it("detects prose field changes with before and after", () => {
    const s1 = buildCanonicalCharacterSnapshot(baseData);
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      personality: "Warm, adventurous.",
      scenarioOverride: "An enchanted forest.",
    });
    const diff = compareCharacterSnapshots(s1, s2, { fromVersion: 1, toVersion: 2 });
    expect(diff.hasChanges).toBe(true);
    expect(diff.fields.personality.changed).toBe(true);
    expect(diff.fields.personality.before).toBe("Loyal, stoic.");
    expect(diff.fields.personality.after).toBe("Warm, adventurous.");
    expect(diff.fields.scenario.changed).toBe(true);
    expect(diff.fields.scenario.before).toBe("Palace courtyard.");
    expect(diff.fields.scenario.after).toBe("An enchanted forest.");
    expect(diff.fields.name.changed).toBe(false);
  });

  it("detects token count deltas correctly", () => {
    const s1 = buildCanonicalCharacterSnapshot({
      ...baseData,
      tokenCount: 2813,
      permanentTokenCount: 2420,
    });
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      tokenCount: 3194,
      permanentTokenCount: 2750,
    });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.tokens.beforeTokenCount).toBe(2813);
    expect(diff.tokens.afterTokenCount).toBe(3194);
    expect(diff.tokens.tokenDelta).toBe(381);
    expect(diff.tokens.permanentTokenDelta).toBe(330);
  });

  it("detects tag additions and removals (+ Fantasy, - Angst)", () => {
    const s1 = buildCanonicalCharacterSnapshot({
      ...baseData,
      tags: [{ name: "Angst", slug: "angst" }],
    });
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      tags: [{ name: "Fantasy", slug: "fantasy" }],
    });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.tags.changed).toBe(true);
    expect(diff.tags.added).toEqual(["Fantasy"]);
    expect(diff.tags.removed).toEqual(["Angst"]);
    expect(diff.tags.unchanged).toEqual([]);
  });

  it("detects greeting additions, removals, and modifications", () => {
    const s1 = buildCanonicalCharacterSnapshot({
      ...baseData,
      greetings: [
        { content: "Greeting 1", position: 0, hidden: false },
        { content: "Greeting 2", position: 1, hidden: false },
      ],
    });
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      greetings: [
        { content: "Greeting 1 modified", position: 0, hidden: false },
        { content: "Greeting 2", position: 1, hidden: false },
        { content: "Greeting 3 newly added", position: 2, hidden: false },
      ],
    });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.greetings.changed).toBe(true);
    expect(diff.greetings.added).toEqual([{ position: 2, content: "Greeting 3 newly added" }]);
    expect(diff.greetings.modified).toEqual([
      { position: 0, beforeContent: "Greeting 1", afterContent: "Greeting 1 modified" },
    ]);
    expect(diff.greetings.removed).toEqual([]);
  });

  it("detects greeting removals", () => {
    const s1 = buildCanonicalCharacterSnapshot({
      ...baseData,
      greetings: [
        { content: "Greeting 1", position: 0, hidden: false },
        { content: "Greeting 2", position: 1, hidden: false },
      ],
    });
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      greetings: [{ content: "Greeting 1", position: 0, hidden: false }],
    });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.greetings.changed).toBe(true);
    expect(diff.greetings.removed).toEqual([{ position: 1, content: "Greeting 2" }]);
  });

  it("detects greeting reordering", () => {
    const s1 = buildCanonicalCharacterSnapshot({
      ...baseData,
      greetings: [
        { content: "Greeting A", position: 0, hidden: false },
        { content: "Greeting B", position: 1, hidden: false },
      ],
    });
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      greetings: [
        { content: "Greeting B", position: 0, hidden: false },
        { content: "Greeting A", position: 1, hidden: false },
      ],
    });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.greetings.changed).toBe(true);
    expect(diff.greetings.reordered).toBe(true);
  });

  it("detects artwork changes", () => {
    const s1 = buildCanonicalCharacterSnapshot({ ...baseData, artworkSha256: "sha-AAA" });
    const s2 = buildCanonicalCharacterSnapshot({ ...baseData, artworkSha256: "sha-BBB" });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.artwork.changed).toBe(true);
    expect(diff.artwork.beforeSha256).toBe("sha-AAA");
    expect(diff.artwork.afterSha256).toBe("sha-BBB");
  });

  it("detects lorebook additions, updates, and removals", () => {
    const s1 = buildCanonicalCharacterSnapshot(baseData);
    const s2 = buildCanonicalCharacterSnapshot({
      ...baseData,
      lorebooks: [
        {
          externalId: "lb-1",
          title: "Citadel Lore",
          description: "Updated lore text",
          sourcePlatform: "JANITOR_AI",
          sourceUrl: "https://example.com/lb1",
          entries: [
            {
              externalEntryId: "e-1",
              content: "Guard lore modified",
              keys: ["guard"],
              enabled: true,
              constant: false,
              insertionOrder: 0,
            },
            {
              externalEntryId: "e-2",
              content: "New entry",
              keys: ["throne"],
              enabled: true,
              constant: false,
              insertionOrder: 1,
            },
          ],
        },
      ],
    });
    const diff = compareCharacterSnapshots(s1, s2);
    expect(diff.lorebooks.changed).toBe(true);
    expect(diff.lorebooks.modifiedLorebooks.length).toBe(1);
    expect(diff.lorebooks.modifiedLorebooks[0].title).toBe("Citadel Lore");
    expect(diff.lorebooks.modifiedLorebooks[0].entriesAdded).toBe(1);
    expect(diff.lorebooks.modifiedLorebooks[0].entriesModified).toBe(1);
  });
});
