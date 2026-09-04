"use client";

import { useCharacterCollections } from "./character-collections-provider";
import { CollectionIcon } from "./collection-icon";

export function CharacterCollectionActions({
  characterId,
  characterName,
  variant,
}: {
  characterId: string;
  characterName: string;
  variant: "card" | "quick-view" | "record";
}) {
  const collections = useCharacterCollections();
  const favorite = collections.favoriteIds.has(characterId);
  const inCart = collections.cartIds.has(characterId);
  const showLabels = variant === "record";

  return (
    <div className={`character-collection-actions character-collection-actions-${variant}`} onClick={(event) => event.stopPropagation()}>
      <CollectionToggle
        collection="favorite"
        characterName={characterName}
        active={favorite}
        busy={collections.isPending("favorites", characterId)}
        showLabel={showLabels}
        onToggle={() => void collections.setFavorite(characterId, characterName, !favorite)}
      />
      <CollectionToggle
        collection="cart"
        characterName={characterName}
        active={inCart}
        busy={collections.isPending("cart", characterId)}
        showLabel={showLabels}
        onToggle={() => void collections.setCart(characterId, characterName, !inCart)}
      />
    </div>
  );
}

function CollectionToggle({
  collection,
  characterName,
  active,
  busy,
  showLabel = false,
  onToggle,
}: {
  collection: "favorite" | "cart";
  characterName: string;
  active: boolean;
  busy: boolean;
  showLabel?: boolean;
  onToggle: () => void;
}) {
  const collectionLabel = collection === "favorite" ? "Favorites" : "Cart";
  const verb = active ? "Remove" : "Add";
  const label = `${verb} ${characterName} ${active ? "from" : "to"} ${collectionLabel}`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={`${verb} ${active ? "from" : "to"} ${collectionLabel}`}
      disabled={busy}
      data-collection={collection}
      data-active={active}
      onClick={onToggle}
      className={`character-collection-toggle ${showLabel ? "character-collection-toggle-labeled" : ""} archive-focus`}
    >
      <CollectionIcon name={collection} active={active} />
      {showLabel && <span>{active ? `${collectionLabel}` : `Add to ${collectionLabel}`}</span>}
    </button>
  );
}
