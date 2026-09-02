import { describe, expect, it, vi } from "vitest";
import { restoreQuickViewFocus, selectCharacterPage, updateCharacterSelection } from "./character-card-grid";

describe("character page selection", () => {
  it("toggles canonical Character.id values without duplicates", () => {
    expect(updateCharacterSelection([], "character-1", true)).toEqual(["character-1"]);
    expect(updateCharacterSelection(["character-1"], "character-1", true)).toEqual(["character-1"]);
    expect(updateCharacterSelection(["character-1", "character-2"], "character-1", false)).toEqual(["character-2"]);
  });

  it("selects only the supplied current-page IDs", () => {
    expect(selectCharacterPage(["character-1", "character-2", "character-1"])).toEqual(["character-1", "character-2"]);
  });

  it("restores focus to the card that opened Quick View", () => {
    const opener = { focus: vi.fn() };
    const defer = vi.fn((callback: () => void) => callback());
    restoreQuickViewFocus(opener, defer);
    expect(defer).toHaveBeenCalledOnce();
    expect(opener.focus).toHaveBeenCalledOnce();
  });
});
