import { describe, expect, it } from "vitest";
import { parseJanitorCharacterUrl } from "./parse-url";

const CHARACTER_ID = "62650d46-bcda-4eac-90a5-1162cb3d5d80";

describe("parseJanitorCharacterUrl", () => {
  it("extracts the UUID from a valid Janitor AI character URL", () => {
    expect(
      parseJanitorCharacterUrl(
        `https://janitorai.com/characters/${CHARACTER_ID}_character-mafia-boss`,
      ),
    ).toBe(CHARACTER_ID);
  });

  it("accepts the www.janitorai.com hostname", () => {
    expect(
      parseJanitorCharacterUrl(`https://www.janitorai.com/characters/${CHARACTER_ID}_bride`),
    ).toBe(CHARACTER_ID);
  });

  it("rejects non-Janitor hostnames", () => {
    expect(() =>
      parseJanitorCharacterUrl(`https://example.com/characters/${CHARACTER_ID}_bride`),
    ).toThrow(/hostname/i);
  });

  it("rejects HTTP URLs", () => {
    expect(() =>
      parseJanitorCharacterUrl(`http://janitorai.com/characters/${CHARACTER_ID}_bride`),
    ).toThrow(/HTTPS/i);
  });

  it("rejects URLs outside the characters path", () => {
    expect(() =>
      parseJanitorCharacterUrl(`https://janitorai.com/chat/${CHARACTER_ID}_bride`),
    ).toThrow(/\/characters\//i);
  });

  it("rejects malformed UUIDs", () => {
    expect(() =>
      parseJanitorCharacterUrl("https://janitorai.com/characters/not-a-uuid_bride"),
    ).toThrow(/valid UUID/i);
  });
});
