import { describe, expect, it } from "vitest";
import { resolveCharacterArtworkUrl } from "./presentation";

describe("shared Character artwork resolver", () => {
  const durable = "a".repeat(64);

  it("keeps legacy external artwork URLs working", () => {
    expect(resolveCharacterArtworkUrl({ id: "character-a", avatarUrl: "https://images.example/source.png" }))
      .toBe("https://images.example/source.png");
  });

  it("prefers durable uploaded artwork over the source URL", () => {
    expect(resolveCharacterArtworkUrl({ id: "character/a", artworkSha256: durable, avatarUrl: "https://images.example/source.png" }))
      .toBe(`/api/characters/character%2Fa/artwork?v=${durable}`);
  });

  it("keeps the explicit override at the highest precedence", () => {
    expect(resolveCharacterArtworkUrl({
      id: "character-a",
      avatarUrlOverride: "https://images.example/override.png",
      artworkSha256: durable,
      avatarUrl: "https://images.example/source.png",
    })).toBe("https://images.example/override.png");
  });

  it("returns null so established component placeholders remain in control", () => {
    expect(resolveCharacterArtworkUrl({ id: "character-a" })).toBeNull();
  });
});
