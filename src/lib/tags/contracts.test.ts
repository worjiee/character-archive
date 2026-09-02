import { describe, expect, it } from "vitest";
import {
  TAG_SEARCH_DEFAULT_LIMIT,
  TAG_SEARCH_MAX_LIMIT,
  TagSearchInputError,
  parseTagSearchParams,
} from "./contracts";

describe("tag search request validation", () => {
  it("uses explicit bounded defaults", () => {
    expect(parseTagSearchParams(new URLSearchParams())).toEqual({
      query: "",
      source: "ALL",
      page: 1,
      limit: TAG_SEARCH_DEFAULT_LIMIT,
    });
  });

  it("accepts persisted source vocabulary and the maximum page size", () => {
    expect(parseTagSearchParams(new URLSearchParams(`q=%23Male&source=SAUCEPAN&page=2&limit=${TAG_SEARCH_MAX_LIMIT}`)))
      .toEqual({ query: "#Male", source: "SAUCEPAN", page: 2, limit: 100 });
  });

  it.each([
    "source=JANNY",
    "source=INVALID",
    "limit=101",
    "limit=0",
    "page=-1",
    "orderBy=count",
  ])("rejects unsupported input: %s", (query) => {
    expect(() => parseTagSearchParams(new URLSearchParams(query))).toThrow(TagSearchInputError);
  });
});
