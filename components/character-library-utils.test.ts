import { describe, expect, it, vi } from "vitest";
import {
  activeCharacterFilterCount,
  buildCharacterSourceNavigation,
  selectedSourceNavigationKey,
  showModalWhenClosed,
  sourceFiltersForNavigation,
} from "./character-library-utils";

describe("character library utilities", () => {
  it("counts active URL-backed filters", () => {
    expect(activeCharacterFilterCount({ query: "theron", sources: ["JANITOR_AI"], tags: ["fantasy"], statuses: ["ACTIVE"], sort: "updated", page: 1, pageSize: 30 })).toBe(4);
  });

  it("builds source navigation from server facets rather than page items", () => {
    const items = buildCharacterSourceNavigation(245, [
      { value: "JANITOR_AI", label: "Janitor AI", count: 200 },
      { value: "SAUCEPAN", label: "Saucepan", count: 45 },
      { value: "DATACAT", label: "Datacat", count: 0 },
      { value: "OTHER", label: "Other", count: 3 },
    ]);
    expect(items.map(({ key, count }) => [key, count])).toEqual([
      ["ALL", 245], ["JANITOR_AI", 200], ["JANNY", null], ["SAUCEPAN", 45], ["DATACAT", 0],
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
