"use client";

import { useRef, useState } from "react";
import type { CharacterCardItem } from "@/src/lib/characters/browse";
import { CharacterLibraryCard } from "./character-library-card";
import { CharacterQuickViewHost } from "./character-quick-view-host";
import { useCharacterCollections } from "./character-collections-provider";

export function CharacterCardGrid({
  characters,
  className = "dense-character-grid",
  selectable = false,
  selection,
}: {
  characters: CharacterCardItem[];
  className?: string;
  selectable?: boolean;
  selection?: {
    selectedIds: readonly string[];
    onChange: (characterId: string, selected: boolean) => void;
  };
}) {
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);
  const collections = useCharacterCollections();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const pageIds = characters.map((character) => character.id);
  const activeSelectedIds = selection?.selectedIds ?? selectedIds;
  const cardsSelectable = selectable || Boolean(selection);

  function openQuickView(characterId: string, trigger: HTMLButtonElement) {
    openerRef.current = trigger;
    setQuickViewId(characterId);
  }

  function closeQuickView() {
    setQuickViewId(null);
    restoreQuickViewFocus(openerRef.current);
  }

  function updateSelection(characterId: string, selected: boolean) {
    setSelectedIds((current) => updateCharacterSelection(current, characterId, selected));
    setCartFeedback(null);
  }

  async function addSelectedToCart() {
    const result = await collections.addManyToCart(selectedIds);
    if (!result.success) {
      setCartFeedback("Could not add the selected characters. Please try again.");
      return;
    }
    setCartFeedback(result.added > 0
      ? `${result.added} ${result.added === 1 ? "character" : "characters"} added · Cart ${result.count}`
      : `All selected characters are already in Cart · Cart ${result.count}`);
  }

  return (
    <>
      {selectable && selectedIds.length > 0 && (
        <div className="character-selection-toolbar" role="region" aria-label="Character selection">
          <p><strong>{selectedIds.length}</strong> selected</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setSelectedIds(selectCharacterPage(pageIds))} className="archive-focus">Select page</button>
            <button type="button" onClick={() => { setSelectedIds([]); setCartFeedback(null); }} className="archive-focus">Deselect all</button>
            <button
              type="button"
              disabled={selectedIds.some((id) => collections.isPending("cart", id))}
              onClick={() => void addSelectedToCart()}
              className="archive-focus"
            >Add selected to Cart</button>
          </div>
          {cartFeedback && <p className="character-selection-feedback" role="status">{cartFeedback}</p>}
        </div>
      )}
      {selectable && selectedIds.length === 0 && (
        <div className="character-selection-rest">
          <span>Select characters for bulk Cart actions</span>
          <button type="button" onClick={() => setSelectedIds(selectCharacterPage(pageIds))} className="archive-focus">Select page</button>
        </div>
      )}
      <div className={className}>
        {characters.map((character) => (
          <CharacterLibraryCard
            key={character.id}
            character={character}
            selected={cardsSelectable && activeSelectedIds.includes(character.id)}
            onSelectedChange={selection
              ? (selected) => selection.onChange(character.id, selected)
              : selectable ? (selected) => updateSelection(character.id, selected) : undefined}
            onOpen={(trigger) => openQuickView(character.id, trigger)}
          />
        ))}
      </div>
      {quickViewId && (
        <CharacterQuickViewHost
          characterId={quickViewId}
          navigationItems={characters.map(({ id, name }) => ({ id, name }))}
          onNavigate={setQuickViewId}
          onClose={closeQuickView}
        />
      )}
    </>
  );
}

export function updateCharacterSelection(selectedIds: readonly string[], characterId: string, selected: boolean): string[] {
  if (selected) return selectedIds.includes(characterId) ? [...selectedIds] : [...selectedIds, characterId];
  return selectedIds.filter((id) => id !== characterId);
}

export function selectCharacterPage(characterIds: readonly string[]): string[] {
  return [...new Set(characterIds)];
}

export function restoreQuickViewFocus(
  opener: Pick<HTMLButtonElement, "focus"> | null,
  defer: (callback: () => void) => void = (callback) => { window.setTimeout(callback, 0); },
): void {
  defer(() => opener?.focus());
}
