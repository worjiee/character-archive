import { describe, expect, it } from "vitest";
import {
  analyzeBulkCharacterUrls,
  BULK_CHARACTER_URL_LIMIT,
  detectCharacterSourceUrl,
} from "./source-url";

const ID = "d7745ac8-8b75-48ec-aaf9-5699ad547cd7";

describe("character source URL detection", () => {
  it.each([
    [`https://janitorai.com/characters/${ID}_character-theron`, "JANITOR_AI"],
    [`https://saucepan.ai/companion/${ID}`, "SAUCEPAN"],
    [`https://datacat.run/characters/recent/janitor/${ID}`, "DATACAT"],
    [`https://www.jannyai.com/characters/${ID}_character-theron`, "JANNY"],
  ])("recognizes %s as %s", (url, platform) => {
    expect(detectCharacterSourceUrl(url)).toMatchObject({ recognized: true, platform, externalId: ID });
  });

  it("separates recognition from retrieval capability", () => {
    expect(detectCharacterSourceUrl(`https://janitorai.com/characters/${ID}_theron`)).toMatchObject({
      recognized: true,
      singleCapability: "EXPERIMENTAL",
      bulkCapability: "UNSUPPORTED",
    });
    expect(detectCharacterSourceUrl(`https://saucepan.ai/companion/${ID}`)).toMatchObject({
      recognized: true,
      singleCapability: "UNSUPPORTED",
    });
  });

  it("returns distinct malformed and unsupported states", () => {
    expect(detectCharacterSourceUrl("not a url")).toMatchObject({ recognized: false, issue: "MALFORMED" });
    expect(detectCharacterSourceUrl(`https://example.com/characters/${ID}`)).toMatchObject({ recognized: false, issue: "UNSUPPORTED" });
    expect(detectCharacterSourceUrl("https://janitorai.com/profiles/example")).toMatchObject({ recognized: false, issue: "MALFORMED_TARGET" });
  });
});

describe("bulk character URL parsing", () => {
  it("accepts mixed newlines and commas, ignores blanks, and preserves order", () => {
    const analysis = analyzeBulkCharacterUrls(`\nhttps://janitorai.com/characters/${ID}_a,\n https://saucepan.ai/companion/${ID}\n`);
    expect(analysis.items.map(({ detection }) => detection.recognized && detection.platform)).toEqual(["JANITOR_AI", "SAUCEPAN"]);
    expect(analysis.uniqueCount).toBe(2);
    expect(analysis.validCount).toBe(2);
  });

  it("detects exact duplicates without sending or retaining a second copy", () => {
    const url = `https://janitorai.com/characters/${ID}_a`;
    const analysis = analyzeBulkCharacterUrls(`${url}\n${url},${url}`);
    expect(analysis.uniqueCount).toBe(1);
    expect(analysis.duplicateCount).toBe(2);
    expect(analysis.items).toHaveLength(1);
  });

  it("counts invalid and recognized sources without network retrieval", () => {
    const analysis = analyzeBulkCharacterUrls(`https://example.com/a\nhttps://datacat.run/characters/${ID}`);
    expect(analysis).toMatchObject({ validCount: 1, invalidCount: 1, sourceCounts: { DATACAT: 1 } });
  });

  it("rejects more than 100 unique entries without truncation", () => {
    const input = Array.from({ length: BULK_CHARACTER_URL_LIMIT + 1 }, (_, index) => `https://example.com/${index}`).join("\n");
    const analysis = analyzeBulkCharacterUrls(input);
    expect(analysis.overLimit).toBe(true);
    expect(analysis.uniqueCount).toBe(101);
    expect(analysis.items).toHaveLength(101);
  });
});
