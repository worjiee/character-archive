import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterQuickViewData } from "@/src/lib/characters/browse";
import { CharacterCollectionsProvider } from "./character-collections-provider";
import {
  CharacterQuickView,
  handleQuickViewCancel,
  isQuickViewProseExpandable,
  quickViewDirectionForKey,
  shouldIgnoreQuickViewArrowTarget,
} from "./character-quick-view";
import { quickViewNeighbors } from "./character-quick-view-host";

describe("Datacat-aligned character Quick View", () => {
  it("renders the bounded rich projection, source identity, navigation, and full-record action", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [character.id], cartIds: [] }}>
        <CharacterQuickView
          characterId={character.id}
          character={character}
          loading={false}
          error={null}
          previousCharacter={{ id: "character-0", name: "Previous" }}
          nextCharacter={{ id: "character-2", name: "Next" }}
          onPrevious={vi.fn()}
          onNext={vi.fn()}
          onClose={vi.fn()}
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).toContain('class="character-quick-view-dialog"');
    expect(html).toContain('data-character-id="character-1"');
    expect(html).toContain("Local Theron");
    expect(html).toContain("Local description");
    expect(html).toContain("Local personality");
    expect(html).toContain("Source scenario");
    expect(html).toContain("Hello there");
    expect(html).toContain("World lorebook");
    expect(html).toContain("J.AI");
    expect(html).toContain("+2");
    expect(html).toContain('aria-label="Previous character: Previous"');
    expect(html).toContain('aria-label="Next character: Next"');
    expect(html).toContain('aria-label="Close character preview"');
    expect(html).toContain("quick-view-personality-section");
    expect(html).toContain("Expand");
    expect(html).not.toContain("&lt;p&gt;");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain(">Close</button>");
    expect(html).toContain('href="/characters/character-1"');
    expect(html).toContain("View full record");
    expect(html).toContain("Download");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Remove Local Theron from Favorites"');
    expect(html).toContain('aria-label="Add Local Theron to Cart"');
    expect(html).not.toContain(">Open original <");
    expect(html).toContain("Original source");
    expect(html).toContain('href="https://example.com/character"');
    expect(html).toContain("Added by Archive Admin");
    expect(html).toContain("Source added by Archive Admin");
    expect(html).toContain("First published");
    expect(html).not.toContain("rawData");
  });

  it("derives current-page previous/next items and truthful boundaries", () => {
    const items = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
    expect(quickViewNeighbors(items, "a")).toEqual({ previousCharacter: undefined, nextCharacter: items[1] });
    expect(quickViewNeighbors(items, "b")).toEqual({ previousCharacter: items[0], nextCharacter: items[2] });
    expect(quickViewNeighbors(items, "c")).toEqual({ previousCharacter: items[1], nextCharacter: undefined });
    expect(quickViewNeighbors(items, "outside")).toEqual({ previousCharacter: undefined, nextCharacter: undefined });
  });

  it("renders Favorite and Cart actions only from the current user's provider state", () => {
    const renderFor = (initialState: { favoriteIds: string[]; cartIds: string[] }) => renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={initialState}>
        <CharacterQuickView characterId={character.id} character={character} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    const userA = renderFor({ favoriteIds: [character.id], cartIds: [] });
    const userB = renderFor({ favoriteIds: [], cartIds: [character.id] });
    expect(userA).toContain('aria-label="Remove Local Theron from Favorites"');
    expect(userA).toContain('aria-label="Add Local Theron to Cart"');
    expect(userB).toContain('aria-label="Add Local Theron to Favorites"');
    expect(userB).toContain('aria-label="Remove Local Theron from Cart"');
  });

  it("maps arrow keys only at enabled boundaries and ignores editing controls", () => {
    expect(quickViewDirectionForKey("ArrowLeft", null, true, true)).toBe("previous");
    expect(quickViewDirectionForKey("ArrowRight", null, true, true)).toBe("next");
    expect(quickViewDirectionForKey("ArrowLeft", null, false, true)).toBeNull();
    expect(quickViewDirectionForKey("ArrowRight", null, true, false)).toBeNull();
    expect(quickViewDirectionForKey("Escape", null, true, true)).toBeNull();
    const input = { tagName: "input", isContentEditable: false, getAttribute: () => null } as unknown as EventTarget;
    const slider = { tagName: "div", isContentEditable: false, getAttribute: () => "slider" } as unknown as EventTarget;
    expect(shouldIgnoreQuickViewArrowTarget(input)).toBe(true);
    expect(shouldIgnoreQuickViewArrowTarget(slider)).toBe(true);
    expect(quickViewDirectionForKey("ArrowRight", input, true, true)).toBeNull();
  });

  it("turns native dialog cancel into an Escape close", () => {
    const preventDefault = vi.fn();
    const close = vi.fn();
    handleQuickViewCancel({ preventDefault }, close);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("bounds only genuinely long personality previews", () => {
    expect(isQuickViewProseExpandable("Short personality")).toBe(false);
    expect(isQuickViewProseExpandable("Long personality ".repeat(24))).toBe(true);
    expect(isQuickViewProseExpandable("1\n2\n3\n4\n5\n6")).toBe(true);
  });
});

const character: CharacterQuickViewData = {
  id: "character-1",
  name: "Local Theron",
  avatarUrl: "/local.webp",
  status: "ACTIVE",
  description: "<p>Local description</p><script>alert(1)</script>",
  personality: "Local personality ".repeat(24).trim(),
  scenario: "Source scenario",
  exampleDialogs: "Example dialog",
  updatedAt: "2026-08-20T00:00:00.000Z",
  publishedAt: "2026-08-19T00:00:00.000Z",
  uploaderName: "Archive Admin",
  sources: [{
    platform: "JANITOR_AI",
    creatorName: "Creator",
    sourceUrl: "https://example.com/character",
    addedBy: "Archive Admin",
  }],
  sourceCount: 1,
  tags: [
    { name: "Fantasy", slug: "fantasy" },
    { name: "Male", slug: "male" },
    { name: "Adventure", slug: "adventure" },
    { name: "Hero", slug: "hero" },
    { name: "Magic", slug: "magic" },
    { name: "Human", slug: "human" },
  ],
  tagCount: 8,
  greetingCount: 3,
  greetingPreview: { id: "greeting-1", content: "Hello there", source: { platform: "JANITOR_AI", creatorName: "Creator" } },
  lorebookCount: 2,
  lorebooks: [{ id: "lorebook-1", title: "World lorebook", sourcePlatform: "DATACAT" }],
};
