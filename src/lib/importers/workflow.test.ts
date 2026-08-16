import { describe, expect, it, vi } from "vitest";
import type { NormalizedCharacter } from "./types";
import {
  previewDevelopmentCharacter,
  saveDevelopmentCharacter,
  toImportPreview,
} from "./workflow";

const normalized: NormalizedCharacter = {
  externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
  platform: "JANITOR_AI",
  sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_fixture",
  name: "Theron",
  description: "Description",
  personality: "Personality",
  scenario: "Scenario",
  exampleDialogs: "Example",
  avatarUrl: "/theron-placeholder.svg",
  creator: { externalId: "creator-1", name: "DKU" },
  greetings: [{ content: "Hello", position: 0 }],
  tags: [{ name: "Fantasy", slug: "fantasy" }],
  lorebookReferences: [{ externalId: "lore-1", title: "World" }],
  rawData: { privateToServerBoundary: true },
};

describe("development import workflow", () => {
  it("creates a safe preview without raw source data", () => {
    const preview = toImportPreview(normalized);

    expect(preview.name).toBe("Theron");
    expect(preview.provider).toBe("development-fixture");
    expect(preview).not.toHaveProperty("rawData");
    expect(preview).not.toHaveProperty("exampleDialogs");
  });

  it("uses the injectable fixture loader for preview", async () => {
    const load = vi.fn().mockResolvedValue(normalized);

    await expect(previewDevelopmentCharacter(normalized.sourceUrl, load)).resolves.toMatchObject({
      externalId: normalized.externalId,
      name: "Theron",
    });
    expect(load).toHaveBeenCalledOnce();
  });

  it("persists the normalized result through the existing service boundary", async () => {
    const load = vi.fn().mockResolvedValue(normalized);
    const persist = vi.fn().mockResolvedValue({
      characterId: "character-1",
      characterSourceId: "source-1",
    });
    const loadLorebook = vi.fn().mockResolvedValue({
      externalId: "lore-1",
      platform: "JANITOR_AI",
      title: "World",
      description: null,
      sourceUrl: "https://janitorai.com/lorebooks/lore-1",
      entries: [],
      rawData: [],
    });
    const persistLorebook = vi.fn().mockResolvedValue({
      lorebookId: "lorebook-1",
      entryCount: 0,
      characterId: "character-1",
    });

    await expect(
      saveDevelopmentCharacter(normalized.sourceUrl, { load, persist, loadLorebook, persistLorebook }),
    ).resolves.toEqual({
      characterId: "character-1",
      characterSourceId: "source-1",
      lorebooks: [{ lorebookId: "lorebook-1", entryCount: 0, characterId: "character-1" }],
    });
    expect(persist).toHaveBeenCalledWith(normalized);
    expect(loadLorebook).toHaveBeenCalledWith("lore-1");
    expect(persistLorebook).toHaveBeenCalledWith(expect.objectContaining({ externalId: "lore-1" }), {
      characterId: "character-1",
    });
  });
});
