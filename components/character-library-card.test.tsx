import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterCardItem } from "@/src/lib/characters/browse";
import { CharacterCollectionsProvider } from "./character-collections-provider";
import { CHARACTER_CARD_TAG_LIMIT, CharacterLibraryCard } from "./character-library-card";

const character: CharacterCardItem = {
  id: "character-1",
  name: "Theron",
  avatarUrl: "/local-override.webp",
  status: "ACTIVE",
  sources: [{ platform: "JANITOR_AI", creatorName: "Creator" }],
  tags: [
    { name: "Fantasy", slug: "fantasy" },
    { name: "Male", slug: "male" },
    { name: "Adventure", slug: "adventure" },
    { name: "Hidden fourth", slug: "fourth" },
  ],
};

describe("dense CharacterLibraryCard", () => {
  it("keeps a native preview button for mouse, Enter, and Space activation", () => {
    const onOpen = vi.fn();
    const tree = CharacterLibraryCard({ character, onOpen, selected: false, onSelectedChange: vi.fn() });
    const trigger = findElement(tree, (element) => element.type === "button" && element.props["aria-haspopup"] === "dialog");
    const source = {} as HTMLButtonElement;

    expect(trigger).toBeDefined();
    (trigger?.props.onClick as ((event: { currentTarget: HTMLButtonElement }) => void) | undefined)?.({ currentTarget: source });
    expect(onOpen).toHaveBeenCalledWith(source);
  });

  it("renders a separately labeled checkbox that only changes selection", () => {
    const onOpen = vi.fn();
    const onSelectedChange = vi.fn();
    const tree = CharacterLibraryCard({ character, onOpen, selected: false, onSelectedChange });
    const checkbox = findElement(tree, (element) => element.type === "input" && element.props.type === "checkbox");

    expect(checkbox?.props["aria-label"]).toBe("Select Theron");
    (checkbox?.props.onChange as ((event: { target: { checked: boolean } }) => void) | undefined)?.({ target: { checked: true } });
    expect(onSelectedChange).toHaveBeenCalledWith(true);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("shows source identity, local artwork projection, selected state, and caps visible tags", () => {
    const html = renderCard({ favoriteIds: [], cartIds: [] });
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("/local-override.webp");
    expect(html).toContain("J.AI");
    expect(html).toContain("Fantasy");
    expect(html).toContain("+1");
    expect(html).not.toContain("Hidden fourth");
    expect(CHARACTER_CARD_TAG_LIMIT).toBe(3);
  });

  it("places synchronized Favorite and Cart controls on artwork with truthful labels", () => {
    const inactiveHtml = renderCard({ favoriteIds: [], cartIds: [] });
    expect(inactiveHtml).toContain('aria-label="Add Theron to Favorites"');
    expect(inactiveHtml).toContain('title="Add to Favorites"');
    expect(inactiveHtml).toContain('aria-label="Add Theron to Cart"');
    expect(inactiveHtml).toContain('aria-pressed="false"');

    const activeHtml = renderCard({ favoriteIds: [character.id], cartIds: [character.id] });
    expect(activeHtml).toContain('aria-label="Remove Theron from Favorites"');
    expect(activeHtml).toContain('title="Remove from Favorites"');
    expect(activeHtml).toContain('aria-label="Remove Theron from Cart"');
    expect(activeHtml).toContain('data-collection="favorite" data-active="true"');
    expect(activeHtml).toContain('data-collection="cart" data-active="true"');
  });
});

function renderCard(initialState: { favoriteIds: string[]; cartIds: string[] }): string {
  return renderToStaticMarkup(
    <CharacterCollectionsProvider initialState={initialState}>
      <CharacterLibraryCard character={character} onOpen={vi.fn()} selected onSelectedChange={vi.fn()} />
    </CharacterCollectionsProvider>,
  );
}

function findElement(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (!isValidElement<Record<string, unknown>>(node)) return undefined;
  if (predicate(node)) return node;
  for (const child of Children.toArray(node.props.children as ReactNode)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return undefined;
}
