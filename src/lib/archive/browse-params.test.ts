import { describe, expect, it } from "vitest";
import {
  characterBrowseHref,
  lorebookBrowseHref,
  parseCharacterBrowseParams,
  parseLorebookBrowseParams,
  searchParamsToBrowseParams,
} from "./browse-params";


describe("character browse URL state", () => {
  it("parses repeated filters and canonical paging state", () => {
    expect(parseCharacterBrowseParams({ q: " theron ", source: ["JANITOR_AI", "SAUCEPAN"], tag: ["fantasy", "romance"], status: "ACTIVE", sort: "name-asc", page: "2" })).toMatchObject({
      query: "theron", sources: ["JANITOR_AI", "SAUCEPAN"], tags: ["fantasy", "romance"], statuses: ["ACTIVE"], sort: "name-asc", page: 2, pageSize: 30,
    });
  });

  it("drops invalid values, keeps Janny out, and normalizes invalid pages", () => {
    expect(parseCharacterBrowseParams({ source: ["JANNY", "OTHER", "INVALID"], tagSource: "JANNY", tag: ["fantasy", "#Male", "../bad"], status: ["DELETED", "NOPE"], sort: "bad", page: "-4" })).toMatchObject({ sources: ["OTHER"], tags: ["fantasy"], tagSource: "ALL", statuses: [], sort: "updated", page: 1 });
  });

  it("keeps character source and tag vocabulary source independent in URL state", () => {
    const filters = parseCharacterBrowseParams({ source: "JANITOR_AI", tagSource: "SAUCEPAN", tag: "fantasy", page: "4" });
    expect(filters).toMatchObject({ sources: ["JANITOR_AI"], tagSource: "SAUCEPAN", tags: ["fantasy"] });
    expect(characterBrowseHref(filters, { tagSource: "DATACAT" })).toBe("/characters?source=JANITOR_AI&tag=fantasy&tagSource=DATACAT");
    expect(characterBrowseHref(filters, { tags: ["fantasy", "male"] })).toContain("tagSource=SAUCEPAN");
  });

  it("serializes state and resets page when a filter changes", () => {
    const current = parseCharacterBrowseParams({ source: ["JANITOR_AI", "SAUCEPAN"], tag: "fantasy", page: "3" });
    expect(characterBrowseHref(current, { query: "Theron" })).toBe("/characters?q=Theron&source=JANITOR_AI&source=SAUCEPAN&tag=fantasy");
    expect(characterBrowseHref(current, { page: 2 }, { preservePage: true })).toContain("page=2");
  });

  it("parses explicit archive sorts and legacy sort aliases", () => {
    expect(parseCharacterBrowseParams({ sort: "archive_added_newest" })).toMatchObject({ sort: "archive_added_newest" });
    expect(parseCharacterBrowseParams({ sort: "archive_added_oldest" })).toMatchObject({ sort: "archive_added_oldest" });
    expect(parseCharacterBrowseParams({ sort: "archive_updated_newest" })).toMatchObject({ sort: "archive_updated_newest" });
    expect(parseCharacterBrowseParams({ sort: "name_asc" })).toMatchObject({ sort: "name_asc" });
    expect(parseCharacterBrowseParams({ sort: "name_desc" })).toMatchObject({ sort: "name_desc" });
    expect(parseCharacterBrowseParams({ sort: "newest" })).toMatchObject({ sort: "newest" });
    expect(parseCharacterBrowseParams({ sort: "oldest" })).toMatchObject({ sort: "oldest" });
    expect(parseCharacterBrowseParams({ sort: "name-asc" })).toMatchObject({ sort: "name-asc" });
    expect(parseCharacterBrowseParams({ sort: "name-desc" })).toMatchObject({ sort: "name-desc" });
    expect(parseCharacterBrowseParams({ sort: "updated" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "updated-oldest" })).toMatchObject({ sort: "updated-oldest" });
  });

  it("safely normalizes unsupported source-date sorts to default archive sort without masquerading", () => {
    expect(parseCharacterBrowseParams({ sort: "source_created_newest" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "source_created_oldest" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "source_updated_newest" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "source_updated_oldest" })).toMatchObject({ sort: "updated" });
  });

  it("parses new token and greeting sort options", () => {
    expect(parseCharacterBrowseParams({ sort: "tokens-asc" })).toMatchObject({ sort: "tokens-asc" });
    expect(parseCharacterBrowseParams({ sort: "tokens-desc" })).toMatchObject({ sort: "tokens-desc" });
    expect(parseCharacterBrowseParams({ sort: "greetings-desc" })).toMatchObject({ sort: "greetings-desc" });
  });

  it("parses creator param into canonical author identity and string", () => {
    expect(parseCharacterBrowseParams({ creator: "JANITOR_AI:EXTERNAL_ID:cr_123" })).toMatchObject({
      creator: "JANITOR_AI:EXTERNAL_ID:cr_123",
      author: { platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "cr_123" },
    });
    expect(parseCharacterBrowseParams({ creator: "SAUCEPAN:CREATOR_NAME:alice" })).toMatchObject({
      creator: "SAUCEPAN:CREATOR_NAME:alice",
      author: { platform: "SAUCEPAN", kind: "CREATOR_NAME", value: "alice" },
    });
    expect(parseCharacterBrowseParams({ creator: "JANITOR_AI:id~cr_456" })).toMatchObject({
      creator: "JANITOR_AI:EXTERNAL_ID:cr_456",
      author: { platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "cr_456" },
    });
    expect(parseCharacterBrowseParams({ creator: "JANNY:id~bad" })).toMatchObject({
      creator: undefined,
      author: undefined,
    });
  });

  it("parses token range and drops invalid or inverted ranges", () => {
    expect(parseCharacterBrowseParams({ tokenMin: "500", tokenMax: "3000" })).toMatchObject({
      tokenMin: 500,
      tokenMax: 3000,
    });
    expect(parseCharacterBrowseParams({ tokenMin: "5000", tokenMax: "2000" })).toMatchObject({
      tokenMin: undefined,
      tokenMax: undefined,
    });
    expect(parseCharacterBrowseParams({ tokenMin: "-10", tokenMax: "abc" })).toMatchObject({
      tokenMin: undefined,
      tokenMax: undefined,
    });
  });

  it("parses minGreetings, content presence, and personal library filters", () => {
    expect(parseCharacterBrowseParams({
      minGreetings: "3",
      hasArtwork: "true",
      hasLorebook: "false",
      hasScenario: "true",
      hasAltGreetings: "false",
      inFavorites: "true",
      inCart: "true",
      collection: "col_12345",
    })).toMatchObject({
      minGreetings: 3,
      hasArtwork: true,
      hasLorebook: false,
      hasScenario: true,
      hasAltGreetings: false,
      inFavorites: true,
      inCart: true,
      collectionId: "col_12345",
    });

    expect(parseCharacterBrowseParams({
      minGreetings: "0",
      hasArtwork: "maybe",
      inFavorites: "false",
      collection: "<script>",
    })).toMatchObject({
      minGreetings: undefined,
      hasArtwork: undefined,
      inFavorites: undefined,
      collectionId: undefined,
    });
  });

  it("serializes advanced search and filter parameters in characterBrowseHref", () => {
    const current = parseCharacterBrowseParams({});
    const href = characterBrowseHref(current, {
      creator: "JANITOR_AI:EXTERNAL_ID:cr_123",
      tokenMin: 1000,
      tokenMax: 5000,
      minGreetings: 2,
      hasArtwork: true,
      hasLorebook: false,
      hasScenario: true,
      hasAltGreetings: false,
      inFavorites: true,
      inCart: true,
      collectionId: "col_123",
      sort: "tokens-asc",
    });

    expect(href).toContain("creator=JANITOR_AI%3AEXTERNAL_ID%3Acr_123");
    expect(href).toContain("tokenMin=1000");
    expect(href).toContain("tokenMax=5000");
    expect(href).toContain("minGreetings=2");
    expect(href).toContain("hasArtwork=true");
    expect(href).toContain("hasLorebook=false");
    expect(href).toContain("hasScenario=true");
    expect(href).toContain("hasAltGreetings=false");
    expect(href).toContain("inFavorites=true");
    expect(href).toContain("inCart=true");
    expect(href).toContain("collection=col_123");
    expect(href).toContain("sort=tokens-asc");
  });

  it("clears filters when set to undefined in characterBrowseHref patch", () => {
    const current = parseCharacterBrowseParams({
      creator: "JANITOR_AI:EXTERNAL_ID:cr_123",
      tokenMin: "1000",
      hasArtwork: "true",
      inFavorites: "true",
    });
    const cleared = characterBrowseHref(current, {
      creator: undefined,
      tokenMin: undefined,
      hasArtwork: undefined,
      inFavorites: undefined,
    });
    expect(cleared).toBe("/characters");
  });

  it("converts URLSearchParams with single and repeated keys to BrowseSearchParams", () => {
    const searchParams = new URLSearchParams();
    searchParams.set("q", "alden");
    searchParams.append("source", "JANITOR_AI");
    searchParams.append("source", "SAUCEPAN");
    searchParams.set("tokenMax", "3000");
    searchParams.set("hasArtwork", "true");

    const browseParams = searchParamsToBrowseParams(searchParams);
    expect(browseParams).toEqual({
      q: "alden",
      source: ["JANITOR_AI", "SAUCEPAN"],
      tokenMax: "3000",
      hasArtwork: "true",
    });

    const parsed = parseCharacterBrowseParams(browseParams);
    expect(parsed.query).toBe("alden");
    expect(parsed.sources).toEqual(["JANITOR_AI", "SAUCEPAN"]);
    expect(parsed.tokenMax).toBe(3000);
    expect(parsed.hasArtwork).toBe(true);
  });
});


describe("lorebook browse URL state", () => {
  it("parses and serializes validated search, source, sort, and page values", () => {
    const filters = parseLorebookBrowseParams({ q: "places", source: "DATACAT", sort: "title-desc", page: "4" });
    expect(filters).toMatchObject({ query: "places", sources: ["DATACAT"], sort: "title-desc", page: 4 });
    expect(lorebookBrowseHref(filters, { page: 2 }, { preservePage: true })).toBe("/lorebooks?q=places&source=DATACAT&sort=title-desc&page=2");
  });

  it("resets invalid lorebook URL values safely", () => {
    expect(parseLorebookBrowseParams({ source: "JANNY", sort: "unknown", page: "NaN" })).toMatchObject({ sources: [], sort: "updated", page: 1 });
  });
});
