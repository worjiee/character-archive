import { describe, expect, it, vi } from "vitest";
import {
  activeCharacterFilterCount,
  buildCharacterSourceNavigation,
  selectedSourceNavigationKey,
  showModalWhenClosed,
  sourceFiltersForNavigation,
} from "./character-library-utils";

describe("character library utilities", () => {
  it("counts active URL-backed filters excluding query, sort, and page", () => {
    expect(activeCharacterFilterCount({
      query: "theron",
      sources: ["JANITOR_AI"],
      tags: ["fantasy"],
      tagSource: "ALL",
      statuses: ["ACTIVE"],
      sort: "updated",
      page: 1,
      pageSize: 30,
    })).toBe(3);
  });

  it("counts advanced search criteria accurately", () => {
    expect(activeCharacterFilterCount({
      query: "hero",
      sources: ["JANITOR_AI", "SAUCEPAN"],
      tags: ["fantasy", "romance"],
      tagSource: "ALL",
      statuses: [],
      sort: "tokens-asc",
      page: 2,
      pageSize: 30,
      creator: "JANITOR_AI:EXTERNAL_ID:cr_1",
      tokenMin: 500,
      tokenMax: 3000,
      minGreetings: 2,
      hasArtwork: true,
      hasLorebook: false,
      hasScenario: true,
      hasAltGreetings: true,
      inFavorites: true,
      inCart: true,
      collectionId: "col-123",
    })).toBe(14); // 2 sources + 2 tags + 1 creator + 1 token range + 1 greetings + 4 content + 3 library = 14
  });

  it("builds source navigation from server facets rather than page items", () => {
    const items = buildCharacterSourceNavigation(245, [
      { value: "JANITOR_AI", label: "Janitor AI", count: 200 },
      { value: "SAUCEPAN", label: "Saucepan", count: 45 },
      { value: "DATACAT", label: "Datacat", count: 0 },
      { value: "OTHER", label: "Other", count: 3 },
    ]);
    expect(items.map(({ key, count }) => [key, count])).toEqual([
      ["ALL", 245], ["JANITOR_AI", 200], ["SAUCEPAN", 45], ["DATACAT", 0], ["JANNY", null],
    ]);
  });

  it("keeps Janny disabled and separate from Other", () => {
    expect(sourceFiltersForNavigation("JANNY")).toBeNull();
    expect(sourceFiltersForNavigation("ALL")).toEqual([]);
    expect(sourceFiltersForNavigation("JANITOR_AI")).toEqual(["JANITOR_AI"]);
  });

  it("derives the selected source tab only for a single supported source", () => {
    expect(selectedSourceNavigationKey([])).toBe("ALL");
    expect(selectedSourceNavigationKey(["SAUCEPAN"])).toBe("SAUCEPAN");
    expect(selectedSourceNavigationKey(["SAUCEPAN", "DATACAT"])).toBeNull();
    expect(selectedSourceNavigationKey(["OTHER"])).toBeNull();
  });

  it("opens a closed dialog only once", () => {
    const dialog = { open: false, showModal() { this.open = true; } };
    const showModal = vi.spyOn(dialog, "showModal");
    showModalWhenClosed(dialog);
    showModalWhenClosed(dialog);
    expect(showModal).toHaveBeenCalledOnce();
  });
});
