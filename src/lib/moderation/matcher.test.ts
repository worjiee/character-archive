import { describe, expect, it } from "vitest";
import type { FilterableCharacter, ModerationRule } from "./matcher";
import { evaluateCharacterBlocklist } from "./matcher";

function character(overrides: Partial<FilterableCharacter> = {}): FilterableCharacter {
  return {
    name: "Force Ghost",
    description: "A vision of Anakin Skywalker appears.",
    personality: "Quiet and reflective",
    scenario: "A distant galaxy",
    exampleDialogs: "May the Force be with you",
    greetings: ["You recognize the old Jedi."],
    tags: [{ name: "Star Wars", slug: "star-wars" }],
    sources: [{ platform: "JANITOR_AI", externalCreatorId: "Creator-42", creatorName: "ExampleCreator" }],
    ...overrides,
  };
}

function rule(type: ModerationRule["type"], value: string, id = `${type}-1`): ModerationRule {
  return { id, type, value, enabled: true };
}

describe("evaluateCharacterBlocklist", () => {
  it("matches character names case-insensitively", () => {
    const result = evaluateCharacterBlocklist(
      character({ name: "MICHAEL JACKSON" }),
      [rule("CHARACTER_NAME", "Michael Jackson")],
    );
    expect(result).toMatchObject({ blocked: true, matches: [{ matchedField: "name" }] });
  });

  it("matches a keyword in the description with normalized whitespace", () => {
    const result = evaluateCharacterBlocklist(character(), [rule("KEYWORD", "  ANAKIN   skywalker ")]);
    expect(result.matches[0]).toMatchObject({ matchedField: "description", matchedValue: expect.stringContaining("Anakin") });
  });

  it("matches keywords in personality", () => {
    const result = evaluateCharacterBlocklist(
      character({ description: null, personality: "Secret Sith Lord" }),
      [rule("KEYWORD", "sith lord")],
    );
    expect(result.matches[0].matchedField).toBe("personality");
  });

  it("matches keywords in greetings", () => {
    const result = evaluateCharacterBlocklist(
      character({ description: null, personality: null, greetings: ["Hello, chosen one."] }),
      [rule("KEYWORD", "chosen one")],
    );
    expect(result.matches[0].matchedField).toBe("greetings.0");
  });

  it("matches tags exactly after normalization", () => {
    const matching = evaluateCharacterBlocklist(
      character({ tags: [{ name: "BTS", slug: "bts" }] }),
      [rule("TAG", " bTs ")],
    );
    const nonMatching = evaluateCharacterBlocklist(
      character({ tags: [{ name: "BTS Fan", slug: "bts-fan" }] }),
      [rule("TAG", "BTS")],
    );
    expect(matching.blocked).toBe(true);
    expect(nonMatching.blocked).toBe(false);
  });

  it("matches creator rules by bounded name and exact ID", () => {
    const result = evaluateCharacterBlocklist(character(), [
      rule("CREATOR_NAME", "examplecreator"),
      rule("CREATOR_ID", "creator-42"),
    ]);
    expect(result.matches.map((match) => match.type)).toEqual(["CREATOR_NAME", "CREATOR_ID"]);
  });

  it("matches platform-specific and platform-agnostic blocked creators", () => {
    const result = evaluateCharacterBlocklist(character(), [], [
      { id: "specific", platform: "JANITOR_AI", externalCreatorId: null, creatorName: "examplecreator", enabled: true },
      { id: "agnostic", platform: null, externalCreatorId: "CREATOR-42", creatorName: null, enabled: true },
      { id: "wrong-platform", platform: "DATACAT", externalCreatorId: null, creatorName: "ExampleCreator", enabled: true },
    ]);
    expect(result.matches.map((match) => match.ruleId)).toEqual(["specific", "agnostic"]);
  });

  it("does not match short words inside longer words", () => {
    const result = evaluateCharacterBlocklist(
      character({ name: "Annabelle", description: "An annual celebration" }),
      [rule("CHARACTER_NAME", "Ann"), rule("KEYWORD", "Ann")],
    );
    expect(result).toEqual({ blocked: false, matches: [] });
  });

  it("returns multiple simultaneous structured matches", () => {
    const result = evaluateCharacterBlocklist(character(), [
      rule("KEYWORD", "Anakin Skywalker", "keyword"),
      rule("CREATOR_NAME", "ExampleCreator", "creator"),
      rule("TAG", "Star Wars", "tag"),
    ]);
    expect(result.blocked).toBe(true);
    expect(result.matches).toHaveLength(3);
    expect(result.matches[0]).toEqual({
      ruleId: "keyword",
      type: "KEYWORD",
      value: "Anakin Skywalker",
      matchedField: "description",
      matchedValue: "A vision of Anakin Skywalker appears.",
    });
  });

  it("ignores disabled and non-matching rules", () => {
    const disabled = { ...rule("KEYWORD", "Anakin Skywalker"), enabled: false };
    expect(evaluateCharacterBlocklist(character(), [disabled, rule("TAG", "BTS")]))
      .toEqual({ blocked: false, matches: [] });
  });
});
