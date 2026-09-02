import { describe, expect, it } from "vitest";
import {
  alphabeticalTagGroup,
  canonicalNameForSourceTag,
  normalizeTagLabel,
  normalizeTagWhitespace,
} from "./normalization";

describe("tag normalization", () => {
  it.each([
    ["Male", "male"],
    [" male ", "male"],
    ["#Male", "male"],
    ["#  Male", "male"],
    ["Ｍａｌｅ", "male"],
  ])("normalizes %s to the shared search identity", (value, expected) => {
    expect(normalizeTagLabel(value)).toBe(expected);
  });

  it("normalizes whitespace but preserves non-leading punctuation", () => {
    expect(normalizeTagLabel(" Dead   Dove! ")).toBe("dead dove!");
    expect(normalizeTagLabel("C++")).toBe("c++");
    expect(normalizeTagWhitespace("#  Male")).toBe("# Male");
  });

  it("uses hash-free names only when creating a new canonical tag", () => {
    expect(canonicalNameForSourceTag("#Fantasy")).toBe("Fantasy");
    expect(canonicalNameForSourceTag("C#")).toBe("C#");
  });

  it("groups letters alphabetically and symbols under hash", () => {
    expect(alphabeticalTagGroup(normalizeTagLabel("#Fantasy"))).toBe("F");
    expect(alphabeticalTagGroup(normalizeTagLabel("42"))).toBe("#");
    expect(alphabeticalTagGroup(normalizeTagLabel("⚔️ Adventure"))).toBe("#");
  });
});
