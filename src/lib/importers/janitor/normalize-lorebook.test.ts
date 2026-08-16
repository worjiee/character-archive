import { describe, expect, it } from "vitest";
import {
  JanitorLorebookNormalizationError,
  normalizeJanitorLorebook,
} from "./normalize-lorebook";

const metadata = {
  externalId: "lore-dku-locations",
  title: "DKU Locations & Clubs",
  description: "Synthetic fixture",
  sourceUrl: "https://janitorai.com/lorebooks/lore-dku-locations",
};

describe("normalizeJanitorLorebook", () => {
  it("normalizes valid entries, preserves Unicode, ordering, and raw data", () => {
    const source = [
      { id: 20, content: "Café Étoile is open after dusk.", key: [" café ", "Étoile"] },
      { id: "entry-10", content: "The north club uses a blue door.", key: ["north club"] },
    ];
    const result = normalizeJanitorLorebook(source, metadata);

    expect(result).toMatchObject({
      externalId: "lore-dku-locations",
      platform: "JANITOR_AI",
      title: "DKU Locations & Clubs",
      entries: [
        { externalEntryId: "20", content: "Café Étoile is open after dusk.", insertionOrder: 0 },
        { externalEntryId: "entry-10", insertionOrder: 1 },
      ],
    });
    expect(result.rawData).toBe(source);
    expect(result.entries[0].rawData).toBe(source[0]);
  });

  it("rejects a malformed non-array source", () => {
    expect(() => normalizeJanitorLorebook({ entries: [] }, metadata)).toThrowError(
      expect.objectContaining<Partial<JanitorLorebookNormalizationError>>({ code: "INVALID_SOURCE" }),
    );
  });

  it("trims and deduplicates keys while preserving first occurrence", () => {
    const result = normalizeJanitorLorebook([
      { id: "keys", content: "Synthetic content", key: [" Club ", "Club", "", "クラブ", "クラブ"] },
    ], metadata);
    expect(result.entries[0].keys).toEqual(["Club", "クラブ"]);
  });

  it("maps optional Janitor fields and sensible boolean defaults", () => {
    const result = normalizeJanitorLorebook([
      { id: "defaults", content: "Default options" },
      {
        id: "options",
        content: "Configured options",
        category: "Locations",
        comment: "Night venue",
        enabled: false,
        constant: true,
        insertion_order: 42,
        case_sensitive: true,
        activationMode: "manual",
        activationScript: "return true;",
        groupWeight: 75,
      },
    ], metadata);
    expect(result.entries[0]).toMatchObject({ enabled: true, constant: false, keys: [] });
    expect(result.entries[1]).toMatchObject({
      category: "Locations",
      comment: "Night venue",
      enabled: false,
      constant: true,
      insertionOrder: 42,
      caseSensitive: true,
      activationMode: "manual",
      activationScript: "return true;",
      groupWeight: 75,
    });
  });

  it("rejects unsafe IDs, duplicate IDs, invalid options, and blank content", () => {
    expect(() => normalizeJanitorLorebook([{ id: Number.MAX_SAFE_INTEGER + 1, content: "x" }], metadata))
      .toThrowError(expect.objectContaining({ code: "INVALID_ENTRY", entryIndex: 0 }));
    expect(() => normalizeJanitorLorebook([{ id: "same", content: "x" }, { id: "same", content: "y" }], metadata))
      .toThrowError(expect.objectContaining({ code: "DUPLICATE_ENTRY_ID" }));
    expect(() => normalizeJanitorLorebook([{ id: "bad", content: "x", enabled: "yes" }], metadata))
      .toThrowError(expect.objectContaining({ code: "INVALID_ENTRY" }));
    expect(() => normalizeJanitorLorebook([{ id: "blank", content: "   " }], metadata))
      .toThrowError(expect.objectContaining({ code: "INVALID_ENTRY" }));
  });
});
