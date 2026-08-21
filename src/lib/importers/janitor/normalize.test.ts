import { describe, expect, it } from "vitest";
import { JanitorNormalizationError, normalizeJanitorCharacter, parseDateOrNull } from "./normalize";
import type { JanitorCharacterResponse } from "./types";

const CHARACTER_ID = "62650d46-bcda-4eac-90a5-1162cb3d5d80";
const SOURCE_URL = `https://janitorai.com/characters/${CHARACTER_ID}_character-mafia-boss`;

function createFixture(
  overrides: Partial<JanitorCharacterResponse> = {},
): JanitorCharacterResponse {
  return {
    id: CHARACTER_ID,
    name: "Bride",
    description: "A guarded heiress.",
    creator_id: "creator-42",
    creator_name: "Example Creator",
    first_message: "Fallback greeting",
    unknown_source_field: { preserved: true },
    ...overrides,
  };
}

describe("normalizeJanitorCharacter", () => {
  it("rejects a missing character name", () => {
    const source = createFixture({ name: undefined });

    expect(() => normalizeJanitorCharacter(source, SOURCE_URL)).toThrowError(
      expect.objectContaining<Partial<JanitorNormalizationError>>({
        name: "JanitorNormalizationError",
        code: "MISSING_NAME",
      }),
    );
  });

  it("rejects a whitespace-only character name", () => {
    const source = createFixture({ name: "   \t\n " });

    expect(() => normalizeJanitorCharacter(source, SOURCE_URL)).toThrowError(
      expect.objectContaining<Partial<JanitorNormalizationError>>({ code: "MISSING_NAME" }),
    );
  });

  it("rejects a source ID that does not match the URL ID", () => {
    const source = createFixture({ id: "65a62bc8-392b-4875-9d65-b7dc8501c233" });

    expect(() => normalizeJanitorCharacter(source, SOURCE_URL)).toThrowError(
      expect.objectContaining<Partial<JanitorNormalizationError>>({
        code: "SOURCE_ID_MISMATCH",
      }),
    );
  });

  it("prefers and orders multiple first_messages", () => {
    const source = createFixture({
      first_messages: ["First greeting", "Second greeting"],
    });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).greetings).toEqual([
      { content: "First greeting", position: 0 },
      { content: "Second greeting", position: 1 },
    ]);
  });

  it("falls back to first_message when first_messages is empty", () => {
    const source = createFixture({ first_messages: [] });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).greetings).toEqual([
      { content: "Fallback greeting", position: 0 },
    ]);
  });

  it("normalizes rich text across character fields and greetings while preserving raw source", () => {
    const originalDescription = "<p><strong>Readable</strong> description</p>";
    const source = createFixture({
      description: originalDescription,
      personality: "<span>Steady</span>",
      scenario: "<p>First</p><p>Second</p>",
      example_dialogs: "{{char}}: Hello<br>{{user}}: Hi",
      first_messages: ["<p>Hello <em>{{user}}</em></p>"],
    });

    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);

    expect(normalized).toMatchObject({
      description: "Readable description",
      personality: "Steady",
      scenario: "First\n\nSecond",
      exampleDialogs: "{{char}}: Hello\n{{user}}: Hi",
      greetings: [{ content: "Hello {{user}}", position: 0 }],
    });
    expect((normalized.rawData as JanitorCharacterResponse).description).toBe(originalDescription);
  });

  it("removes duplicate greetings while preserving their first position", () => {
    const source = createFixture({
      first_messages: ["Hello", "Welcome", "Hello", "Stay awhile"],
    });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).greetings).toEqual([
      { content: "Hello", position: 0 },
      { content: "Welcome", position: 1 },
      { content: "Stay awhile", position: 2 },
    ]);
  });

  it("normalizes tag names and slugs", () => {
    const source = createFixture({
      tags: [
        { id: "tag-1", name: "  Mafia Boss  ", slug: " Mafia_Boss " },
        { name: "Slow Burn Romance" },
      ],
    });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).tags).toEqual([
      { externalId: "tag-1", name: "Mafia Boss", slug: "mafia-boss" },
      { name: "Slow Burn Romance", slug: "slow-burn-romance" },
    ]);
  });

  it("resolves an observed bare Janitor avatar filename to its asset URL", () => {
    const source = createFixture({ avatar: "sanitized-avatar-file.webp" });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).avatarUrl).toBe(
      "https://ella.janitorai.com/bot-avatars/sanitized-avatar-file.webp",
    );
  });

  it.each([
    "https://images.example.test/avatar.webp",
    "/local-development-avatar.svg",
  ])("preserves an already usable avatar location: %s", (avatar) => {
    const source = createFixture({ avatar });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).avatarUrl).toBe(avatar);
  });

  it("deduplicates tags by normalized slug while preserving the first tag", () => {
    const source = createFixture({
      tags: [
        { id: "first-tag", name: "Mafia Boss" },
        { id: "duplicate-tag", name: "Duplicate", slug: "mafia_boss" },
        { id: "third-tag", name: "Slow Burn" },
      ],
    });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).tags).toEqual([
      { externalId: "first-tag", name: "Mafia Boss", slug: "mafia-boss" },
      { externalId: "third-tag", name: "Slow Burn", slug: "slow-burn" },
    ]);
  });

  it("creates references only for lorebook scripts", () => {
    const source = createFixture({
      scripts: [
        { id: "lore-1", type: "lorebook", title: "Family history" },
        { id: "script-1", type: "javascript", title: "UI helper" },
        { id: "lore-2", type: "lorebook", title: "City guide" },
      ],
    });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).lorebookReferences).toEqual([
      { externalId: "lore-1", title: "Family history" },
      { externalId: "lore-2", title: "City guide" },
    ]);
  });

  it("deduplicates lorebook references by external ID while preserving the first", () => {
    const source = createFixture({
      scripts: [
        { id: "lore-1", type: "lorebook", title: "Original title" },
        { id: "lore-1", type: "lorebook", title: "Duplicate title" },
        { id: "lore-2", type: "lorebook", title: "Second lorebook" },
      ],
    });

    expect(normalizeJanitorCharacter(source, SOURCE_URL).lorebookReferences).toEqual([
      { externalId: "lore-1", title: "Original title" },
      { externalId: "lore-2", title: "Second lorebook" },
    ]);
  });

  it("preserves the complete original response as rawData", () => {
    const source = createFixture();

    expect(normalizeJanitorCharacter(source, SOURCE_URL).rawData).toBe(source);
  });

  it("parses valid created_at and updated_at ISO timestamps", () => {
    const source = createFixture({
      created_at: "2024-01-15T10:30:00.000Z",
      updated_at: "2024-06-20T14:00:00.000Z",
    });
    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);
    expect(normalized.sourceCreatedAt).toEqual(new Date("2024-01-15T10:30:00.000Z"));
    expect(normalized.sourceUpdatedAt).toEqual(new Date("2024-06-20T14:00:00.000Z"));
  });

  it("returns null for missing source timestamps", () => {
    const source = createFixture();
    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);
    expect(normalized.sourceCreatedAt).toBeNull();
    expect(normalized.sourceUpdatedAt).toBeNull();
  });

  it("returns null for null source timestamps", () => {
    const source = createFixture({ created_at: null, updated_at: null });
    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);
    expect(normalized.sourceCreatedAt).toBeNull();
    expect(normalized.sourceUpdatedAt).toBeNull();
  });

  it("returns null for malformed source timestamps without throwing", () => {
    const source = createFixture({
      created_at: "not-a-date",
      updated_at: "also-invalid",
    });
    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);
    expect(normalized.sourceCreatedAt).toBeNull();
    expect(normalized.sourceUpdatedAt).toBeNull();
  });

  it("returns null for empty string source timestamps", () => {
    const source = createFixture({ created_at: "", updated_at: "   " });
    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);
    expect(normalized.sourceCreatedAt).toBeNull();
    expect(normalized.sourceUpdatedAt).toBeNull();
  });

  it("preserves rawData unchanged when source timestamps are parsed", () => {
    const source = createFixture({
      created_at: "2024-01-15T10:30:00.000Z",
      updated_at: "2024-06-20T14:00:00.000Z",
    });
    const normalized = normalizeJanitorCharacter(source, SOURCE_URL);
    expect((normalized.rawData as JanitorCharacterResponse).created_at).toBe("2024-01-15T10:30:00.000Z");
    expect((normalized.rawData as JanitorCharacterResponse).updated_at).toBe("2024-06-20T14:00:00.000Z");
  });
});

describe("parseDateOrNull", () => {
  it.each([
    ["2024-01-15T10:30:00.000Z", new Date("2024-01-15T10:30:00.000Z")],
    ["2024-06-20", new Date("2024-06-20")],
    ["2024-01-15T10:30:00+08:00", new Date("2024-01-15T10:30:00+08:00")],
  ])("parses valid ISO string %s", (input, expected) => {
    expect(parseDateOrNull(input)).toEqual(expected);
  });

  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    ["not-a-date", null],
    ["Invalid Date", null],
  ] as const)("returns null for %s", (input, expected) => {
    expect(parseDateOrNull(input)).toBe(expected);
  });
});
