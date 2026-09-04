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
});
