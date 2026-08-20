import { describe, expect, it } from "vitest";
import { lorebookDetailHref } from "./lorebook-library-utils";

describe("lorebook library routes", () => {
  it("builds the internal lorebook detail route safely", () => {
    expect(lorebookDetailHref("lorebook id")).toBe("/lorebooks/lorebook%20id");
  });
});
