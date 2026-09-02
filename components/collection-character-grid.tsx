"use client";

import Link from "next/link";
import type { CharacterCardItem } from "../src/lib/characters/browse";
import type { CharacterCollectionKind } from "../src/lib/characters/collections";
import { CharacterCardGrid } from "./character-card-grid";
import { useCharacterCollections } from "./character-collections-provider";

export function CollectionCharacterGrid({
  collection,
  characters,
  filtered = false,
  limited = false,
}: {
  collection: CharacterCollectionKind;
  characters: CharacterCardItem[];
  filtered?: boolean;
  limited?: boolean;
}) {
  const collections = useCharacterCollections();
  const collectionIds = collection === "favorites" ? collections.favoriteIds : collections.cartIds;
  const visibleCharacters = characters.filter((character) => collectionIds.has(character.id));

  if (collectionIds.size === 0) return <CollectionEmptyState collection={collection} />;
  if (visibleCharacters.length === 0) {
    return (
      <section className="collection-empty-state" aria-label="No matching Favorites">
        <p className="archive-eyebrow">No matches</p>
        <h2>No favorites match this search.</h2>
        <p>Try another character or creator name.</p>
        <Link href="/favorites" className="archive-button-secondary archive-focus">Clear search</Link>
      </section>
    );
  }

  return (
    <section className="collection-results" aria-label={collection === "favorites" ? "Favorite characters" : "Cart characters"}>
      {filtered && <p className="collection-result-note">{visibleCharacters.length} matching {visibleCharacters.length === 1 ? "favorite" : "favorites"}</p>}
      {limited && <p className="collection-result-note">Showing the first 100 characters. Refine Favorites search to narrow the collection.</p>}
      <CharacterCardGrid
        characters={visibleCharacters}
        className="dense-character-grid collection-character-grid"
      />
    </section>
  );
}

function CollectionEmptyState({ collection }: { collection: CharacterCollectionKind }) {
  const isFavorites = collection === "favorites";
  return (
    <section className="collection-empty-state" aria-label={isFavorites ? "Favorites empty" : "Cart empty"}>
      <p className="archive-eyebrow">{isFavorites ? "No favorites yet" : "Your Cart is empty"}</p>
      <h2>{isFavorites
        ? "Favorite characters from the Characters browser to keep them here."
        : "Add characters to prepare them for export."}</h2>
      <Link href="/characters" className="archive-button-secondary archive-focus">Browse Characters</Link>
    </section>
  );
}
