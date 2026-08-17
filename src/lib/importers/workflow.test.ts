import { describe, expect, it, vi } from "vitest";
import type { NormalizedCharacter } from "./types";
import {
  previewDevelopmentCharacter,
  previewManualCharacter,
  saveManualCharacter,
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

  it("creates a safe manual preview without raw source data", () => {
    const sourceJson = JSON.stringify({
      id: normalized.externalId,
      name: normalized.name,
      creator_name: normalized.creator.name,
      first_messages: normalized.greetings.map((greeting) => greeting.content),
      tags: [{ id: 42, name: "Fantasy", slug: "fantasy" }],
      scripts: [{ id: "lore-1", type: "lorebook", title: "World" }],
    });
    const preview = previewManualCharacter(normalized.sourceUrl, sourceJson);

    expect(preview.provider).toBe("manual-json");
    expect(preview.sourceUrl).toBe(normalized.sourceUrl);
    expect(preview.greetings).toHaveLength(1);
    expect(preview.tags).toEqual([{ externalId: "42", name: "Fantasy", slug: "fantasy" }]);
    expect(preview.lorebookReferences).toEqual([{ externalId: "lore-1", title: "World" }]);
    expect(preview).not.toHaveProperty("rawData");
  });

  it("revalidates manual source data and delegates moderation/persistence", async () => {
    const sourceJson = JSON.stringify({ id: normalized.externalId, name: "Blocked example" });
    const persist = vi.fn().mockResolvedValue({
      characterId: "character-1",
      characterSourceId: "source-1",
      status: "QUARANTINED",
      blockedReason: "Matched keyword rule.",
    });

    await expect(saveManualCharacter(normalized.sourceUrl, sourceJson, persist)).resolves.toMatchObject({
      characterId: "character-1",
      status: "QUARANTINED",
    });
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({
      externalId: normalized.externalId,
      sourceUrl: normalized.sourceUrl,
      name: "Blocked example",
      rawData: JSON.parse(sourceJson),
    }));
  });

  it("preserves duplicate-safe source identity on manual re-import", async () => {
    const sourceJson = JSON.stringify({ id: normalized.externalId, name: normalized.name });
    const persist = vi.fn().mockResolvedValue({ characterId: "character-1", characterSourceId: "source-1" });

    const first = await saveManualCharacter(normalized.sourceUrl, sourceJson, persist);
    const second = await saveManualCharacter(normalized.sourceUrl, sourceJson, persist);

    expect(first.characterId).toBe(second.characterId);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls.map(([character]) => character)).toEqual([
      expect.objectContaining({ platform: "JANITOR_AI", externalId: normalized.externalId }),
      expect.objectContaining({ platform: "JANITOR_AI", externalId: normalized.externalId }),
    ]);
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
