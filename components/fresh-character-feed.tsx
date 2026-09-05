"use client";

import { useRef, useState } from "react";
import type { FreshCharacterItem } from "@/src/lib/home/fresh";
import { getSourceIdentity } from "../src/lib/sources/presentation";
import { relativeActivityLabel } from "../src/lib/home/relative-activity";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";
import { CharacterQuickViewHost } from "./character-quick-view-host";
import { useLiveNow } from "./live-time-provider";

export function FreshCharacterFeed({
  characters,
  now: initialNow,
}: {
  characters: FreshCharacterItem[];
  now: string;
}) {
  const now = useLiveNow(initialNow);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  function open(characterId: string, trigger: HTMLButtonElement) {
    openerRef.current = trigger;
    setSelectedId(characterId);
  }

  function close() {
    setSelectedId(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }

  return (
    <>
      <div className="fresh-feed-stream">
        {characters.map((character) => (
          <FreshCharacterRow key={character.id} character={character} now={now} onOpen={open} />
        ))}
      </div>
      {selectedId && <CharacterQuickViewHost characterId={selectedId} onClose={close} />}
    </>
  );
}

export function FreshCharacterRow({
  character,
  now,
  onOpen,
}: {
  character: FreshCharacterItem;
  now: string;
  onOpen: (characterId: string, trigger: HTMLButtonElement) => void;
}) {
  const source = character.sources[0];
  const creators = [...new Set(character.sources.map(({ creatorName }) => creatorName).filter(Boolean))];
  const hiddenTagCount = Math.max(0, character.tagCount - character.tags.length);
  const recency = relativeActivityLabel(character.publishedAt, now);

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(event) => onOpen(character.id, event.currentTarget)}
      className="fresh-feed-row archive-focus group text-left"
    >
      <div className="fresh-row-artwork">
        <CharacterAvatar name={character.name} src={character.avatarUrl} className="h-full w-full rounded-[10px] ring-0" />
        {source && <span className="absolute bottom-1.5 left-1.5"><SourceBadge platform={source.platform} variant="compact" /></span>}
      </div>

      <div className="fresh-row-main">
        <div className="fresh-row-copy">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <h2 className="archive-character-title line-clamp-2 min-h-0 text-zinc-100 transition-colors group-hover:text-violet-200">{character.name}</h2>
            <span className="fresh-row-mobile-meta archive-recency shrink-0 text-[color:var(--accent-text)]">{recency}</span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <span className="archive-author-label shrink-0 text-[color:var(--accent-text)]">Author</span>
            <span className="archive-character-creator truncate text-zinc-400">{creators.length > 0 ? creators.join(", ") : "Unknown creator"}</span>
            {source && <SourceBadge platform={source.platform} variant="compact" />}
          </div>
          <p className="mt-1 text-[0.58rem] text-zinc-600">Added by {character.uploaderName}</p>
          <p className="archive-character-description mt-1.5 text-zinc-400">{character.description?.trim() || "No description provided."}</p>
          <div className="fresh-row-tags mt-1.5">
            {character.tags.map((tag) => <span key={tag.slug} className="archive-card-tag rounded-full border border-zinc-800 bg-zinc-900/70 px-1.5 py-0.5 text-zinc-400">{tag.name}</span>)}
            {hiddenTagCount > 0 && <span className="archive-card-tag rounded-full border border-zinc-800 bg-zinc-900/70 px-1.5 py-0.5 text-zinc-500">+{hiddenTagCount}</span>}
          </div>
        </div>

        <aside className="fresh-row-rail" aria-label="Archive activity">
          <span className="archive-recency text-[color:var(--accent-text)]">{recency}</span>
          <span className="font-interface mt-1 text-[0.58rem] font-semibold uppercase tracking-[0.06em] text-zinc-500">{source ? getSourceIdentity(source.platform).label : "Archive"}</span>
          <span className="font-interface mt-auto text-[0.52rem] uppercase tracking-[0.08em] text-zinc-600">First published</span>
        </aside>
      </div>
    </button>
  );
}
