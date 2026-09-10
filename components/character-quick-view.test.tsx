import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterQuickViewData } from "@/src/lib/characters/browse";
import { CharacterCollectionsProvider } from "./character-collections-provider";
import {
  CharacterQuickView,
  handleQuickViewCancel,
  quickViewDirectionForKey,
  shouldIgnoreQuickViewArrowTarget,
} from "./character-quick-view";
import { quickViewNeighbors } from "./character-quick-view-host";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

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
    expect(html).not.toContain("J.AI Janitor AI");
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

  it("renders Admin-only soft-delete button in footer and omits for Member", () => {
    const adminHtml = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="ADMIN">
        <CharacterQuickView characterId={character.id} character={character} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(adminHtml).toContain("Delete character");
    expect(adminHtml).toContain("quick-view-delete-button");

    const memberHtml = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="MEMBER">
        <CharacterQuickView characterId={character.id} character={character} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(memberHtml).not.toContain("Delete character");
    expect(memberHtml).not.toContain("quick-view-delete-button");
  });

  it("renders two-column loading skeleton to preserve dimensions and avoid vertical shift", () => {
    const loadingHtml = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterQuickView characterId="loading-char" character={null} loading={true} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(loadingHtml).toContain('aria-label="Loading character preview"');
    expect(loadingHtml).toContain("character-quick-view-artwork");
    expect(loadingHtml).toContain("character-quick-view-content");
    expect(loadingHtml).not.toContain("character-quick-view-state");
  });

  it("renders Scenario as a first-class prominent section between Personality and Greetings without narrow grid container", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterQuickView characterId={character.id} character={character} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(html).not.toContain("quick-view-definition-grid");
    expect(html).toContain('id="character-quick-view-scenario"');
    expect(html).toContain("quick-view-prominent-section");
    expect(html).toContain("<h3>Scenario</h3>");
    expect(html).toContain("Source scenario");

    // Verify ordering: Description -> Personality -> Scenario -> Greetings
    const descIdx = html.indexOf('id="character-quick-view-description"');
    const persIdx = html.indexOf('id="character-quick-view-personality"');
    const scenIdx = html.indexOf('id="character-quick-view-scenario"');
    const greetIdx = html.indexOf(">Greetings</h3>");
    expect(descIdx).toBeGreaterThan(-1);
    expect(persIdx).toBeGreaterThan(descIdx);
    expect(scenIdx).toBeGreaterThan(persIdx);
    expect(greetIdx).toBeGreaterThan(scenIdx);
  });

  it("renders expandable details for long Scenario content using the same pattern as Personality", () => {
    const longScenario = "Long descriptive scenario text. ".repeat(20).trim();
    const longChar: CharacterQuickViewData = {
      ...character,
      id: "character-long-scenario",
      scenario: longScenario,
    };
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterQuickView characterId={longChar.id} character={longChar} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain('<details id="character-quick-view-scenario"');
    expect(html).toContain("<span>Scenario</span>");
    expect(html).toContain("Expand");
    expect(html).toContain("Collapse");
  });

  it("omits Scenario heading, divider, and empty gap when character has no scenario", () => {
    const noScenarioChar: CharacterQuickViewData = {
      ...character,
      id: "character-no-scenario",
      scenario: null,
    };
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterQuickView characterId={noScenarioChar.id} character={noScenarioChar} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(html).not.toContain('id="character-quick-view-scenario"');
    expect(html).not.toContain(">Scenario<");
  });

  it("renders exact token count in byline and compact badge in artwork overlay with reference tooltip", () => {
    const tokenChar: CharacterQuickViewData = {
      ...character,
      id: "character-tokens",
      tokenCount: 2545,
      permanentTokenCount: 1663,
    };
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterQuickView characterId={tokenChar.id} character={tokenChar} loading={false} error={null} onClose={vi.fn()} />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain("2,545 tokens");
    expect(html).toContain("2.5K TOKENS");
    expect(html).toContain("Reference token count. Actual token usage may vary by model.");
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
