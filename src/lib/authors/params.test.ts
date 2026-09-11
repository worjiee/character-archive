import { describe, expect, it } from "vitest";
import { authorCharacterBrowseHref, authorDetailHref, authorsBrowseHref, parseAuthorBrowseParams, parseAuthorCharacterBrowseParams, parseAuthorIdentity } from "./params";

describe("author URL state", () => {
  it("parses bounded directory source/search/sort/page state", () => {
    expect(parseAuthorBrowseParams({ q: " Creator ", source: "saucepan", sort: "characters-desc", page: "3" })).toEqual({ query: "Creator", source: "SAUCEPAN", sort: "characters-desc", favoriteOnly: false, page: 3, pageSize: 30 });
    expect(parseAuthorBrowseParams({ source: "JANNY", sort: "invalid", page: "-1" })).toMatchObject({ source: "ALL", sort: "name-asc", page: 1 });
  });

  it("serializes directory state and resets pagination", () => {
    const current = parseAuthorBrowseParams({ q: "Creator", source: "DATACAT", sort: "recent", page: "4" });
    expect(authorsBrowseHref(current, { sort: "name-desc" })).toBe("/authors?q=Creator&source=DATACAT&sort=name-desc");
    expect(authorsBrowseHref(current, { page: 2 }, { preservePage: true })).toBe("/authors?q=Creator&source=DATACAT&sort=recent&page=2");
  });

  it("keeps the Favorite Creators filter URL-backed and resets pagination", () => {
    const current = parseAuthorBrowseParams({ q: "Creator", source: "DATACAT", sort: "recent", favorite: "true", page: "4" });
    expect(current.favoriteOnly).toBe(true);
    expect(authorsBrowseHref(current, { favoriteOnly: false })).toBe("/authors?q=Creator&source=DATACAT&sort=recent");
    expect(authorsBrowseHref(current, { source: "ALL" })).toBe("/authors?q=Creator&sort=recent&favorite=true");
  });

  it("uses explicit safe route identity kinds and keeps legacy external-ID routes", () => {
    const external = { platform: "JANITOR_AI" as const, kind: "EXTERNAL_ID" as const, value: "creator/one" };
    expect(authorDetailHref(external)).toBe("/authors/JANITOR_AI/id~creator%2Fone");
    expect(parseAuthorIdentity("JANITOR_AI", "id~creator%2Fone")).toEqual(external);
    expect(parseAuthorIdentity("JANITOR_AI", "legacy-id")).toEqual({ platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "legacy-id" });
    expect(parseAuthorIdentity("DATACAT", "name~  Creator   Name ")).toEqual({ platform: "DATACAT", kind: "CREATOR_NAME", value: "creator name" });
    expect(parseAuthorIdentity("JANNY", "id~creator")).toBeNull();
  });

  it("preserves author character search, canonical tag filters, sort, and page", () => {
    const author = { platform: "JANITOR_AI" as const, kind: "EXTERNAL_ID" as const, value: "creator-1" };
    const current = parseAuthorCharacterBrowseParams({ q: "hero", tag: ["fantasy", "romance"], sort: "name-desc", page: "3" });
    expect(authorCharacterBrowseHref(author, current, { page: 2 }, { preservePage: true })).toBe("/authors/JANITOR_AI/id~creator-1?q=hero&sort=name-desc&page=2&tag=fantasy&tag=romance");
  });
});
