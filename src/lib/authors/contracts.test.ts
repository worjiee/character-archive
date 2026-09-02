import { describe, expect, it } from "vitest";
import { AuthorTagSearchInputError, parseAuthorTagSearchParams } from "./contracts";

describe("author tag search contract", () => {
  it("uses bounded defaults and accepts bounded pagination", () => {
    expect(parseAuthorTagSearchParams(new URLSearchParams())).toEqual({ query: "", page: 1, limit: 30 });
    expect(parseAuthorTagSearchParams(new URLSearchParams("q=%23Male&page=2&limit=50"))).toEqual({ query: "#Male", page: 2, limit: 50 });
  });

  it("rejects arbitrary fields and out-of-range limits", () => {
    expect(() => parseAuthorTagSearchParams(new URLSearchParams("orderBy=rawData"))).toThrow(AuthorTagSearchInputError);
    expect(() => parseAuthorTagSearchParams(new URLSearchParams("limit=5000"))).toThrow(AuthorTagSearchInputError);
  });
});
