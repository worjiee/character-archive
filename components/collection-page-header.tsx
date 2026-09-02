"use client";

import Link from "next/link";
import type { CharacterCollectionKind } from "../src/lib/characters/collections";
import { useCharacterCollections } from "./character-collections-provider";

export function CollectionPageHeader({ collection }: { collection: CharacterCollectionKind }) {
  const collections = useCharacterCollections();
  const count = collection === "favorites" ? collections.favoriteCount : collections.cartCount;
  const isFavorites = collection === "favorites";
  const countLabel = isFavorites
    ? `${count} saved`
    : `${count} ${count === 1 ? "character" : "characters"}`;

  return (
    <header className="collection-page-header">
      <div className="min-w-0">
        <p className="archive-eyebrow characters-page-eyebrow">{isFavorites ? "Saved collection" : "Export basket"}</p>
        <div className="collection-title-row">
          <h1 className="characters-page-title font-semibold tracking-[-0.025em] text-zinc-50">{isFavorites ? "Favorites" : "Cart"}</h1>
          <strong aria-live="polite">{countLabel}</strong>
        </div>
        <p className="characters-page-subtitle max-w-2xl text-zinc-500">
          {isFavorites ? "Persistent characters you want to keep close." : "Review characters before batch export."}
        </p>
      </div>
      <Link href="/characters" className="archive-button-secondary archive-focus characters-add-button shrink-0">
        {isFavorites ? "Browse characters" : "Add characters"}
      </Link>
    </header>
  );
}
