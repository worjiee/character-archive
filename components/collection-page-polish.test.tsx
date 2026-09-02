import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CharacterCardItem } from "../src/lib/characters/browse";
import { groupCartCharacters } from "../src/lib/characters/cart-groups";
import { CollectionBrowseToolbar } from "./collection-browse-toolbar";
import { CartAuthorGroupedCollection, getSelectionState, updateCartSelection } from "./cart-author-grouped-collection";
import { CollectionCharacterGrid } from "./collection-character-grid";
import { CharacterCollectionsProvider } from "./character-collections-provider";
import { CollectionPageHeader } from "./collection-page-header";

const character: CharacterCardItem = {
  id: "character-1",
  name: "Theron",
  avatarUrl: "/theron.webp",
  status: "ACTIVE",
  sources: [{ platform: "JANITOR_AI", creatorName: "Creator", externalCreatorId: "creator-1" }],
  tags: [{ name: "Fantasy", slug: "fantasy" }],
};

describe("collection page polish", () => {
  it("renders compact truthful empty states", () => {
    const favorites = renderCollection("favorites", [], { favoriteIds: [], cartIds: [] });
    expect(favorites).toContain("No favorites yet");
    expect(favorites).toContain("Favorite characters from the Characters browser to keep them here.");
    expect(favorites).toContain("Browse Characters");

    const cart = renderCart([], []);
    expect(cart).toContain("Your Cart is empty");
    expect(cart).toContain("Add characters to prepare them for export.");
    expect(cart).toContain("Browse Characters");
  });

  it("shows synchronized collection counts in the polished headers", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: ["favorite-1"], cartIds: ["cart-1", "cart-2"] }}>
        <CollectionPageHeader collection="favorites" />
        <CollectionPageHeader collection="cart" />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain("1 saved");
    expect(html).toContain("2 characters");
    expect(html).toContain("Persistent characters you want to keep close.");
    expect(html).toContain("Review characters before batch export.");
  });

  it("renders bounded Favorites search and truthful sort options", () => {
    const html = renderToStaticMarkup(<CollectionBrowseToolbar filters={{ query: "Theron", sort: "saved" }} />);
    expect(html).toContain('placeholder="Search favorites..."');
    expect(html).toContain('maxLength="80"');
    expect(html).toContain("Freshest");
    expect(html).toContain("Recently saved");
  });

  it("groups Cart by author while preserving selection, collection actions, and Quick View", () => {
    const html = renderCart([character], [character.id], [character.id]);
    expect(html).toContain("1 author · 1 bot");
    expect(html).toContain("Creator");
    expect(html).toContain("Janitor AI");
    expect(html).toContain('aria-label="Select 1 character by Creator"');
    expect(html).toContain("0 / 1 selected");
    expect(html).toContain('aria-label="Select Theron"');
    expect(html).toContain('aria-label="Remove Theron from Favorites"');
    expect(html).toContain('aria-label="Remove Theron from Cart"');
    expect(html).toContain('aria-label="Preview Theron"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("0 selected");
  });

  it("supports global, author, and character selection with truthful mixed state", () => {
    expect(updateCartSelection([], ["character-1", "character-2"], true)).toEqual(["character-1", "character-2"]);
    expect(updateCartSelection(["character-1", "character-2"], ["character-1"], false)).toEqual(["character-2"]);
    expect(getSelectionState(["character-1", "character-2"], ["character-1"])).toEqual({
      checked: false,
      indeterminate: true,
    });
  });

  it("exposes real ZIP checkout copy and the explicit 50-character bound", () => {
    const html = renderCart([character], [character.id]);
    expect(html).toContain("Download ZIP");
    expect(html).toContain("up to 50 selected characters");
    expect(html).toContain("Your Cart stays unchanged");
    expect(html).not.toContain("Download selected JSON");
  });
});

function renderCollection(
  collection: "favorites" | "cart",
  characters: CharacterCardItem[],
  initialState: { favoriteIds: string[]; cartIds: string[] },
): string {
  return renderToStaticMarkup(
    <CharacterCollectionsProvider initialState={initialState}>
      <CollectionCharacterGrid collection={collection} characters={characters} />
    </CharacterCollectionsProvider>,
  );
}

function renderCart(characters: CharacterCardItem[], cartIds: string[], favoriteIds: string[] = []): string {
  return renderToStaticMarkup(
    <CharacterCollectionsProvider initialState={{ favoriteIds, cartIds }}>
      <CartAuthorGroupedCollection groups={groupCartCharacters(characters)} />
    </CharacterCollectionsProvider>,
  );
}
