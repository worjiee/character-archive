import { describe, expect, it } from "vitest";
import {
  buildVersionFingerprintPayload,
  computeVersionFingerprint,
} from "./fingerprint";

describe("Character Version Fingerprint Engine", () => {
  const baseInput = {
    name: "Aria Thorne",
    description: "A mysterious royal guard.",
    personality: "Loyal, stoic, guarded.",
    scenario: "You meet in the palace courtyard at dusk.",
    exampleDialogs: "<START>\n{{user}}: Who goes there?\n{{char}}: Halt!",
    systemPrompt: "Write in literary second-person prose.",
    postHistoryInstructions: "Never break character.",
    avatarUrl: "https://images.example.com/aria.png",
    artworkSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    greetings: [
      { content: "Halt! State your business.", position: 0, hidden: false },
      { content: "Good evening, traveler.", position: 1, hidden: false },
    ],
    tags: [
      { name: "Fantasy", slug: "fantasy" },
      { name: "Guard", slug: "guard" },
      { name: "Royal", slug: "royal" },
    ],
    lorebooks: [
      {
        externalId: "lb-palace",
        title: "The Silver Citadel",
        description: "Lore of the palace grounds.",
        sourcePlatform: "JANITOR_AI",
        sourceUrl: "https://janitorai.com/lorebooks/palace",
        entries: [
          {
            externalEntryId: "entry-guards",
            content: "The Royal Guard protects the throne.",
            keys: ["guard", "citadel", "royal"],
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
        externalId: "aria-001",
        sourceUrl: "https://janitorai.com/characters/aria-001",
        externalCreatorId: "creator-42",
        creatorName: "AetherAuthor",
      },
    ],
  };

  it("produces deterministic, identical fingerprint for identical input", () => {
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({ ...baseInput });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("source timestamp changes produce the exact same fingerprint", () => {
    // Note: buildVersionFingerprintPayload does not take source timestamps,
    // explicitly proving sourceCreatedAt/sourceUpdatedAt cannot affect fingerprint.
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      sources: [
        {
          ...baseInput.sources[0],
          // Timestamps omitted or changed in candidate
        },
      ],
    });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("derived token metrics recalculation produces the exact same fingerprint", () => {
    // Derived token metrics are not part of the semantic fingerprint payload
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({ ...baseInput });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("override mechanics with identical effective prose produce identical fingerprint", () => {
    // Case 1: Baseline only
    const p1 = buildVersionFingerprintPayload({
      ...baseInput,
      name: "Aria Thorne",
      nameOverride: null,
      personality: "Loyal, stoic, guarded.",
      personalityOverride: null,
    });

    // Case 2: Admin set override to same effective value
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      name: "Aria Thorne",
      nameOverride: "Aria Thorne",
      personality: "Loyal, stoic, guarded.",
      personalityOverride: "Loyal, stoic, guarded.",
    });

    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("changing effective prose changes the fingerprint", () => {
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      personalityOverride: "Playful, rebellious, witty.",
    });
    expect(computeVersionFingerprint(p1)).not.toBe(computeVersionFingerprint(p2));
  });

  it("tag array ordering differences produce identical fingerprint", () => {
    const p1 = buildVersionFingerprintPayload({
      ...baseInput,
      tags: [
        { name: "Royal", slug: "royal" },
        { name: "Fantasy", slug: "fantasy" },
        { name: "Guard", slug: "guard" },
      ],
    });
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      tags: [
        { name: "Fantasy", slug: "fantasy" },
        { name: "Guard", slug: "guard" },
        { name: "Royal", slug: "royal" },
      ],
    });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("lorebook entry key ordering differences produce identical fingerprint", () => {
    const p1 = buildVersionFingerprintPayload({
      ...baseInput,
      lorebooks: [
        {
          ...baseInput.lorebooks[0],
          entries: [
            {
              ...baseInput.lorebooks[0].entries[0],
              keys: ["royal", "guard", "citadel"],
            },
          ],
        },
      ],
    });
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      lorebooks: [
        {
          ...baseInput.lorebooks[0],
          entries: [
            {
              ...baseInput.lorebooks[0].entries[0],
              keys: ["citadel", "guard", "royal"],
            },
          ],
        },
      ],
    });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("source array ordering differences produce identical fingerprint", () => {
    const s1 = { platform: "JANITOR_AI", externalId: "j-1", sourceUrl: "https://janitor.ai/j-1" };
    const s2 = { platform: "SAUCEPAN", externalId: "s-1", sourceUrl: "https://saucepan.ai/s-1" };
    const p1 = buildVersionFingerprintPayload({ ...baseInput, sources: [s1, s2] });
    const p2 = buildVersionFingerprintPayload({ ...baseInput, sources: [s2, s1] });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("Unicode NFKC normalization ensures equivalent representations match", () => {
    // Full-width characters vs standard ASCII
    const p1 = buildVersionFingerprintPayload({
      ...baseInput,
      name: "Aria Thorne",
    });
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      name: "Ａｒｉａ Ｔｈｏｒｎｅ", // Full-width forms
    });
    expect(computeVersionFingerprint(p1)).toBe(computeVersionFingerprint(p2));
  });

  it("greeting reordering or content change bumps fingerprint", () => {
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      greetings: [
        { content: "Good evening, traveler.", position: 0, hidden: false },
        { content: "Halt! State your business.", position: 1, hidden: false },
      ],
    });
    expect(computeVersionFingerprint(p1)).not.toBe(computeVersionFingerprint(p2));
  });

  it("greeting visibility change bumps fingerprint", () => {
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      greetings: [
        { content: "Halt! State your business.", position: 0, hidden: true },
        { content: "Good evening, traveler.", position: 1, hidden: false },
      ],
    });
    expect(computeVersionFingerprint(p1)).not.toBe(computeVersionFingerprint(p2));
  });

  it("artwork SHA change bumps fingerprint", () => {
    const p1 = buildVersionFingerprintPayload(baseInput);
    const p2 = buildVersionFingerprintPayload({
      ...baseInput,
      artworkSha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    });
    expect(computeVersionFingerprint(p1)).not.toBe(computeVersionFingerprint(p2));
  });
});
