import { describe, expect, it } from "vitest";
import { createImportPreviewSnapshot, ImportPreviewSnapshotError, restoreImportPreviewSnapshot } from "./preview-snapshot";
import type { NormalizedCharacter } from "./types";

const binding = {
  sha256: "a".repeat(64),
  mediaType: "image/png" as const,
  byteLength: 42,
  width: 10,
  height: 20,
  pendingKey: "pending-artwork/1780000000000/aaaaaaaaaaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000000.png",
  expiresAt: "2026-09-01T01:00:00.000Z",
};

describe("immutable artwork preview snapshot", () => {
  it("binds only safe artwork metadata and restores the same digest", () => {
    const snapshot = createImportPreviewSnapshot(character(), binding);
    expect(snapshot).toMatchObject({ version: 2, artwork: binding });
    expect(JSON.stringify(snapshot)).not.toContain("filesystem");
    expect(restoreImportPreviewSnapshot(snapshot).artwork).toEqual(binding);
  });

  it("rejects a client-shaped replacement binding with an invalid digest", () => {
    const snapshot = createImportPreviewSnapshot(character(), binding) as unknown as { artwork: { sha256: string } };
    snapshot.artwork.sha256 = "digest-b";
    expect(() => restoreImportPreviewSnapshot(snapshot)).toThrow(ImportPreviewSnapshotError);
  });

  it("keeps version-one URL-only previews readable", () => {
    const current = createImportPreviewSnapshot(character());
    const legacy = { schema: current.schema, version: 1, character: current.character };
    expect(restoreImportPreviewSnapshot(legacy)).toMatchObject({ artwork: null, character: { avatarUrl: "https://images.example/source.png" } });
  });
});

function character(): NormalizedCharacter {
  return {
    externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    platform: "JANITOR_AI",
    sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    name: "Artwork fixture",
    description: null,
    personality: null,
    scenario: null,
    exampleDialogs: null,
    avatarUrl: "https://images.example/source.png",
    creator: { externalId: null, name: "Creator" },
    greetings: [],
    tags: [],
    lorebookReferences: [],
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    rawData: { excluded: true },
  };
}
