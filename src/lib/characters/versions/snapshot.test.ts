import { describe, expect, it } from "vitest";
import { buildCanonicalCharacterSnapshot } from "./snapshot";

describe("Character Snapshot Builder", () => {
  it("builds a canonical snapshot with schema version 1", () => {
    const snapshot = buildCanonicalCharacterSnapshot({
      name: "Aria Thorne",
      description: "Guard",
      personality: "Loyal",
      scenario: "Courtyard",
      avatarUrl: "https://example.com/aria.png",
      artworkSha256: "sha-123",
      tokenCount: 1500,
      permanentTokenCount: 1200,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      capturedAt: new Date("2026-09-15T00:00:00.000Z"),
      greetings: [
        { content: "Hello", position: 1, localPosition: 0, hidden: false, externalId: "g-1" },
      ],
      tags: [
        { name: "Fantasy", slug: "fantasy" },
      ],
      sources: [
        {
          platform: "JANITOR_AI",
          externalId: "aria-1",
          sourceUrl: "https://janitor.ai/aria-1",
          sourceCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
    });

    expect(snapshot.snapshotSchemaVersion).toBe(1);
    expect(snapshot.character.name).toBe("Aria Thorne");
    expect(snapshot.artwork.sha256).toBe("sha-123");
    expect(snapshot.tokenMetrics.tokenCount).toBe(1500);
    expect(snapshot.tokenMetrics.tokenizerReference).toBe("cl100k_base_v1");
    expect(snapshot.provenance.originalCreatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(snapshot.provenance.capturedAt).toBe("2026-09-15T00:00:00.000Z");
    expect(snapshot.greetings[0].position).toBe(0); // localPosition took precedence
  });

  it("stores overrides in snapshot when present", () => {
    const snapshot = buildCanonicalCharacterSnapshot({
      name: "Aria Thorne",
      nameOverride: "Captain Aria",
      personality: "Loyal",
      personalityOverride: "Fierce",
      greetings: [],
      tags: [],
      sources: [
        { platform: "JANITOR_AI", externalId: "1", sourceUrl: "https://example.com" },
      ],
    });

    expect(snapshot.character.name).toBe("Aria Thorne");
    expect(snapshot.character.overrides?.nameOverride).toBe("Captain Aria");
    expect(snapshot.character.overrides?.personalityOverride).toBe("Fierce");
  });
});
