import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterRecordActions } from "./character-record-actions";
import { CharacterCollectionsProvider } from "./character-collections-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

describe("CharacterRecordActions", () => {
  it("renders Favorite and Cart controls with visible labels for all users", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="MEMBER">
        <CharacterRecordActions
          characterId="char-1"
          characterName="Theron"
          role="MEMBER"
          status="ACTIVE"
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).toContain("Add to Favorites");
    expect(html).toContain("Add to Cart");
    expect(html).not.toContain("Soft-delete character");
  });

  it("renders Soft-delete button for ADMIN users when status is active", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="ADMIN">
        <CharacterRecordActions
          characterId="char-1"
          characterName="Theron"
          role="ADMIN"
          status="ACTIVE"
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).toContain("Add to Favorites");
    expect(html).toContain("Add to Cart");
    expect(html).toContain("Soft-delete character");
  });

  it("omits Soft-delete button when character is already DELETED", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="ADMIN">
        <CharacterRecordActions
          characterId="char-1"
          characterName="Theron"
          role="ADMIN"
          status="DELETED"
        />
      </CharacterCollectionsProvider>,
    );

    expect(html).not.toContain("Soft-delete character");
  });

  it("ensures the visible Favorite and Cart labels are inside the button element, not outside or siblings", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="MEMBER">
        <CharacterRecordActions characterId="char-1" characterName="Theron" role="MEMBER" status="ACTIVE" />
      </CharacterCollectionsProvider>,
    );

    const favButtonMatch = /<button[^>]*data-collection="favorite"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(favButtonMatch).not.toBeNull();
    expect(favButtonMatch![1]).toContain('<span class="character-collection-toggle-label">Add to Favorites</span>');

    const cartButtonMatch = /<button[^>]*data-collection="cart"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(cartButtonMatch).not.toBeNull();
    expect(cartButtonMatch![1]).toContain('<span class="character-collection-toggle-label">Add to Cart</span>');
  });

  it("ensures the active Remove labels are also structurally inside the button element", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: ["char-1"], cartIds: ["char-1"] }} role="ADMIN">
        <CharacterRecordActions characterId="char-1" characterName="Theron" role="ADMIN" status="ACTIVE" />
      </CharacterCollectionsProvider>,
    );

    const favButtonMatch = /<button[^>]*data-collection="favorite"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(favButtonMatch).not.toBeNull();
    expect(favButtonMatch![1]).toContain('<span class="character-collection-toggle-label">Remove from Favorites</span>');

    const cartButtonMatch = /<button[^>]*data-collection="cart"[^>]*>([\s\S]*?)<\/button>/.exec(html);
    expect(cartButtonMatch).not.toBeNull();
    expect(cartButtonMatch![1]).toContain('<span class="character-collection-toggle-label">Remove from Cart</span>');
    expect(html.match(/character-collection-toggle-labeled/g)).toHaveLength(2);
  });
});
