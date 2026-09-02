import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CharacterCollectionsProvider, useCharacterCollections, withMembership } from "./character-collections-provider";

describe("shared character collection state", () => {
  it("changes Favorite without changing Cart or checkbox-style external state", () => {
    const initial = { favoriteIds: [], cartIds: ["character-1"] };
    expect(withMembership(initial, "favorites", "character-1", true)).toEqual({
      favoriteIds: ["character-1"],
      cartIds: ["character-1"],
    });
    expect(initial).toEqual({ favoriteIds: [], cartIds: ["character-1"] });
  });

  it("changes Cart without changing Favorites", () => {
    expect(withMembership({ favoriteIds: ["character-1"], cartIds: [] }, "cart", "character-1", true)).toEqual({
      favoriteIds: ["character-1"],
      cartIds: ["character-1"],
    });
  });

  it("removes Favorite and Cart membership independently for collection-page actions", () => {
    const initial = { favoriteIds: ["character-1"], cartIds: ["character-1"] };
    expect(withMembership(initial, "favorites", "character-1", false)).toEqual({
      favoriteIds: [],
      cartIds: ["character-1"],
    });
    expect(withMembership(initial, "cart", "character-1", false)).toEqual({
      favoriteIds: ["character-1"],
      cartIds: [],
    });
  });

  it("makes one provider state visible to every card, Quick View, and header consumer", () => {
    function Snapshot() {
      const state = useCharacterCollections();
      return <p>{state.favoriteCount}:{state.cartCount}:{String(state.favoriteIds.has("favorite-1"))}:{String(state.cartIds.has("cart-1"))}</p>;
    }
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: ["favorite-1"], cartIds: ["cart-1", "cart-2"] }}>
        <Snapshot />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain("1:2:true:true");
  });

  it("keeps two authenticated users' provider snapshots independent", () => {
    function Snapshot() {
      const state = useCharacterCollections();
      return <p>{state.favoriteCount}:{state.cartCount}:{String(state.favoriteIds.has("character-1"))}:{String(state.cartIds.has("character-1"))}</p>;
    }
    const userA = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: ["character-1"], cartIds: [] }}><Snapshot /></CharacterCollectionsProvider>,
    );
    const userB = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: ["character-1"] }}><Snapshot /></CharacterCollectionsProvider>,
    );
    expect(userA).toContain("1:0:true:false");
    expect(userB).toContain("0:1:false:true");
  });
});
