import { describe, expect, it } from "vitest";
import { parseCharacterBrowseParams } from "../archive/browse-params";
import {
  authorCharacterBrowseHref,
  authorDetailHref,
  authorsBrowseHref,
  parseAuthorBrowseParams,
  parseAuthorIdentity,
} from "./params";

describe("author URL state", () => {
  it("parses bounded author search/sort/page state", () => {
    expect(parseAuthorBrowseParams({ q: " Creator ", sort: "characters-desc", page: "3" })).toEqual({
      query: "Creator",
      sort: "characters-desc",
      page: 3,
      pageSize: 30,
    });
    expect(parseAuthorBrowseParams({ sort: "invalid", page: "-1" })).toMatchObject({ sort: "name-asc", page: 1 });
  });

  it("serializes author library state and resets page on filter changes", () => {
    const current = parseAuthorBrowseParams({ q: "Creator", sort: "recent", page: "4" });
    expect(authorsBrowseHref(current, { sort: "name-desc" })).toBe("/authors?q=Creator&sort=name-desc");
    expect(authorsBrowseHref(current, { page: 2 }, { preservePage: true })).toBe("/authors?q=Creator&sort=recent&page=2");
  });

  it("validates persisted source identity without treating Janny as Other", () => {
    expect(parseAuthorIdentity("janitor_ai", "creator-1")).toEqual({ platform: "JANITOR_AI", externalCreatorId: "creator-1" });
    expect(parseAuthorIdentity("JANNY", "creator-1")).toBeNull();
    expect(parseAuthorIdentity("OTHER", "creator-1")).toEqual({ platform: "OTHER", externalCreatorId: "creator-1" });
    expect(parseAuthorIdentity("JANITOR_AI", "\u0000unsafe")).toBeNull();
  });

  it("creates a stable encoded source-scoped detail route", () => {
    expect(authorDetailHref({ platform: "JANITOR_AI", externalCreatorId: "creator/one" })).toBe("/authors/JANITOR_AI/creator%2Fone");
  });

  it("preserves author character q/tag/status/sort/page state without a redundant source filter", () => {
    const author = { platform: "JANITOR_AI" as const, externalCreatorId: "creator-1" };
    const current = { ...parseCharacterBrowseParams({ q: "hero", tag: "fantasy", status: "ACTIVE", sort: "name-desc", page: "3", source: "DATACAT" }), author };
    expect(authorCharacterBrowseHref(author, current, { page: 2 }, { preservePage: true })).toBe(
      "/authors/JANITOR_AI/creator-1?q=hero&sort=name-desc&page=2&tag=fantasy&status=ACTIVE",
    );
  });
});
