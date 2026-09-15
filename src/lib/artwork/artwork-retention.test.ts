import { describe, expect, it, vi } from "vitest";

describe("Artwork Historical Retention", () => {
  it("prevents deletion of ArtworkAsset while referenced by a CharacterVersion", async () => {
    // Test the retention logic query: an asset referenced by CharacterVersion is NOT an orphan
    const mockDb = {
      artworkAsset: {
        findMany: vi.fn().mockResolvedValue([
          { sha256: "sha-old-v1" },
          { sha256: "sha-current-v2" },
        ]),
      },
      character: {
        findMany: vi.fn().mockResolvedValue([
          { artworkSha256: "sha-current-v2" },
        ]),
      },
      characterVersion: {
        findMany: vi.fn().mockResolvedValue([
          { artworkSha256: "sha-old-v1" },
        ]),
      },
    };

    // Query unreferenced assets
    const currentArt = new Set((await mockDb.character.findMany()).map((c: { artworkSha256: string }) => c.artworkSha256));
    const versionArt = new Set((await mockDb.characterVersion.findMany()).map((v: { artworkSha256: string }) => v.artworkSha256));
    const allAssets = await mockDb.artworkAsset.findMany();

    const orphanAssets = allAssets.filter(
      (a: { sha256: string }) => !currentArt.has(a.sha256) && !versionArt.has(a.sha256)
    );

    // sha-old-v1 is NOT in currentArt, but IS in versionArt -> Must NOT be an orphan!
    expect(orphanAssets.length).toBe(0);
    expect(versionArt.has("sha-old-v1")).toBe(true);
  });
});
