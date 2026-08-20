import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CharacterCardItem } from "@/src/lib/characters/browse";
import { CharacterLibraryCard } from "./character-library-card";

const character: CharacterCardItem = {
  id: "character-1",
  name: "Theron",
  avatarUrl: null,
  status: "ACTIVE",
  sources: [{
    platform: "JANITOR_AI",
    creatorName: "Creator",
  }],
  tags: [{ name: "Fantasy", slug: "fantasy" }],
};

describe("CharacterLibraryCard activation", () => {
  it("uses native button semantics for mouse, Enter, and Space activation", () => {
    const element = CharacterLibraryCard({ character, onOpen: vi.fn() }) as ReactElement<{
      type: string;
      "aria-haspopup": string;
    }>;

    expect(element.type).toBe("button");
    expect(element.props.type).toBe("button");
    expect(element.props["aria-haspopup"]).toBe("dialog");
  });

  it("passes the activated card button to the quick-view opener", () => {
    const onOpen = vi.fn();
    const trigger = {} as HTMLButtonElement;
    const element = CharacterLibraryCard({ character, onOpen }) as ReactElement<{
      onClick: (event: { currentTarget: HTMLButtonElement }) => void;
    }>;

    element.props.onClick({ currentTarget: trigger });

    expect(onOpen).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledWith(trigger);
  });
});
