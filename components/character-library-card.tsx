"use client";

import type { CharacterCardItem } from "@/src/lib/characters/browse";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge, StatusBadge, TokenBadge } from "./character-badges";
import { CharacterCollectionActions } from "./character-collection-actions";

export const CHARACTER_CARD_TAG_LIMIT = 3;

export function CharacterLibraryCard({
  character,
  onOpen,
  selected = false,
  onSelectedChange,
}: {
  character: CharacterCardItem;
  onOpen: (trigger: HTMLButtonElement) => void;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
}) {
  const creators = [...new Set(character.sources.map((source) => source.creatorName).filter(Boolean))];
  const platforms = [...new Set(character.sources.map((source) => source.platform))];
  const selectable = Boolean(onSelectedChange);

  return (
    <article className="dense-character-card" data-selected={selected || undefined}>
      <CharacterCollectionActions characterId={character.id} characterName={character.name} variant="card" />
      {selectable && (
        <label className="dense-character-selector archive-focus" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(event) => onSelectedChange?.(event.target.checked)}
            aria-label={`Select ${character.name}`}
          />
          <span aria-hidden="true" className="dense-character-checkmark">✓</span>
        </label>
      )}
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-haspopup="dialog"
        aria-label={`Preview ${character.name}`}
        className="dense-character-trigger archive-focus group"
      >
        <div className="dense-character-artwork">
          <CharacterAvatar name={character.name} src={character.avatarUrl} className="h-full w-full rounded-none ring-0 transition duration-300 group-hover:scale-[1.018]" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-zinc-950/90 to-transparent" />
          <div className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-end justify-between gap-1">
            <div className="flex gap-1">{platforms.slice(0, 2).map((platform) => <SourceBadge key={platform} platform={platform} variant="compact" />)}</div>
            <div className="flex items-center gap-1">
              {character.tokenCount != null && <TokenBadge tokenCount={character.tokenCount} variant="compact" />}
              {character.status !== "ACTIVE" && <StatusBadge status={character.status} />}
            </div>
          </div>
        </div>
        <div className="dense-character-copy">
          <h2 className="dense-character-name">{character.name}</h2>
          <p className="dense-character-author"><span className="archive-author-label">Author</span><span className="truncate">{creators.length > 0 ? creators.join(", ") : "Unknown creator"}</span></p>
          <div className="dense-character-tags">
            {character.tags.slice(0, CHARACTER_CARD_TAG_LIMIT).map((tag) => <span key={tag.slug} className="archive-card-tag truncate">{tag.name}</span>)}
            {character.tags.length > CHARACTER_CARD_TAG_LIMIT && <span className="archive-card-tag text-zinc-600">+{character.tags.length - CHARACTER_CARD_TAG_LIMIT}</span>}
          </div>
        </div>
      </button>
      {selected && <span className="sr-only">{character.name} selected</span>}
    </article>
  );
}
