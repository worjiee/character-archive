import { describe, expect, it } from "vitest";
import {
  characterBrowseHref,
  lorebookBrowseHref,
  parseCharacterBrowseParams,
  parseLorebookBrowseParams,
} from "./browse-params";

describe("character browse URL state", () => {
  it("parses repeated filters and canonical paging state", () => {
    expect(parseCharacterBrowseParams({ q: " theron ", source: ["JANITOR_AI", "SAUCEPAN"], tag: ["fantasy", "romance"], status: "ACTIVE", sort: "name-asc", page: "2" })).toMatchObject({
      query: "theron", sources: ["JANITOR_AI", "SAUCEPAN"], tags: ["fantasy", "romance"], statuses: ["ACTIVE"], sort: "name-asc", page: 2, pageSize: 30,
    });
  });

  it("drops invalid values, keeps Janny out, and normalizes invalid pages", () => {
    expect(parseCharacterBrowseParams({ source: ["JANNY", "OTHER", "INVALID"], status: ["DELETED", "NOPE"], sort: "bad", page: "-4" })).toMatchObject({ sources: ["OTHER"], statuses: [], sort: "updated", page: 1 });
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
  });

  it("safely normalizes unsupported source-date sorts to default archive sort without masquerading", () => {
    expect(parseCharacterBrowseParams({ sort: "source_created_newest" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "source_created_oldest" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "source_updated_newest" })).toMatchObject({ sort: "updated" });
    expect(parseCharacterBrowseParams({ sort: "source_updated_oldest" })).toMatchObject({ sort: "updated" });
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
