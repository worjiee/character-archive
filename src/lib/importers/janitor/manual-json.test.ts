import { describe, expect, it } from "vitest";
import {
  ManualJanitorImportError,
  MAX_MANUAL_CHARACTER_JSON_BYTES,
  normalizeManualJanitorCharacter,
  parseManualJanitorCharacterJson,
} from "./manual-json";

const CHARACTER_ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const CHARACTER_URL = `https://janitorai.com/characters/${CHARACTER_ID}_character-theron`;

function source(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CHARACTER_ID,
    name: "Theron",
    description: "A public character.",
    creator_id: "creator-1",
    creator_name: "DKU",
    first_messages: ["Hello", { content: "Welcome" }],
    tags: [{ id: "tag-1", name: "Fantasy", slug: "fantasy" }],
    scripts: [{ id: "lore-1", type: "lorebook", title: "World guide" }],
    ...overrides,
  };
}

describe("manual Janitor character JSON", () => {
  it("parses and normalizes a valid character response", () => {
    const normalized = normalizeManualJanitorCharacter(CHARACTER_URL, JSON.stringify(source()));

    expect(normalized).toMatchObject({
      externalId: CHARACTER_ID,
      platform: "JANITOR_AI",
      sourceUrl: CHARACTER_URL,
      name: "Theron",
      creator: { externalId: "creator-1", name: "DKU" },
      greetings: [
        { content: "Hello", position: 0 },
        { content: "Welcome", position: 1 },
      ],
      tags: [{ externalId: "tag-1", name: "Fantasy", slug: "fantasy" }],
      lorebookReferences: [{ externalId: "lore-1", title: "World guide" }],
    });
    expect(normalized.rawData).toEqual(source());
  });

  it("rejects malformed JSON", () => {
    expect(() => parseManualJanitorCharacterJson("{nope"))
      .toThrowError(expect.objectContaining<Partial<ManualJanitorImportError>>({ code: "INVALID_CHARACTER_JSON" }));
  });

  it("rejects a non-object root", () => {
    expect(() => parseManualJanitorCharacterJson("[]"))
      .toThrowError(expect.objectContaining<Partial<ManualJanitorImportError>>({ code: "INVALID_CHARACTER_RESPONSE" }));
  });

  it.each([
    ["missing name", { name: undefined }, "MISSING_CHARACTER_NAME"],
    ["blank name", { name: "  " }, "MISSING_CHARACTER_NAME"],
    ["missing ID", { id: undefined }, "INVALID_CHARACTER_ID"],
    ["invalid ID", { id: "not-a-uuid" }, "INVALID_CHARACTER_ID"],
  ])("rejects %s", (_label, overrides, code) => {
    expect(() => parseManualJanitorCharacterJson(JSON.stringify(source(overrides))))
      .toThrowError(expect.objectContaining({ code }));
  });

  it("rejects a URL and JSON character ID mismatch", () => {
    const otherUrl = "https://janitorai.com/characters/62650d46-bcda-4eac-90a5-1162cb3d5d80_character-other";
    expect(() => normalizeManualJanitorCharacter(otherUrl, JSON.stringify(source())))
      .toThrowError(expect.objectContaining({ code: "SOURCE_ID_MISMATCH" }));
  });

  it("rejects oversized source JSON", () => {
    const oversized = JSON.stringify(source({ description: "x".repeat(MAX_MANUAL_CHARACTER_JSON_BYTES) }));
    expect(() => parseManualJanitorCharacterJson(oversized))
      .toThrowError(expect.objectContaining({ code: "CHARACTER_JSON_TOO_LARGE" }));
  });

  it.each([
    { authorization: "Bearer secret" },
    { headers: { cookie: "session=secret" } },
    { localStorage: { token: "secret" } },
    { nested: { refresh_token: "secret" } },
  ])("rejects credential or browser-session shaped data", (credentialData) => {
    expect(() => parseManualJanitorCharacterJson(JSON.stringify(source(credentialData))))
      .toThrowError(expect.objectContaining({ code: "CREDENTIAL_DATA_REJECTED" }));
  });

  it("rejects malformed optional Janitor structures", () => {
    expect(() => parseManualJanitorCharacterJson(JSON.stringify(source({ tags: "fantasy" }))))
      .toThrowError(expect.objectContaining({ code: "INVALID_CHARACTER_RESPONSE" }));
  });
});
