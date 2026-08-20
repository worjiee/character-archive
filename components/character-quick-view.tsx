"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { CharacterQuickViewData } from "@/src/lib/characters/browse";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge, StatusBadge } from "./character-badges";
import { SourceLinkActions } from "./source-link-actions";
import { showModalWhenClosed } from "./character-library-utils";

export function CharacterQuickView({
  characterId,
  character,
  loading,
  error,
  onClose,
}: {
  characterId: string;
  character: CharacterQuickViewData | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const creators = [...new Set(character?.sources.map((source) => source.creatorName).filter(Boolean) ?? [])];
  const firstSource = character?.sources[0];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.documentElement.style.overflow;
    showModalWhenClosed(dialog);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
    };
  }, [characterId]);

  function close() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="character-quick-view-title"
      aria-describedby={character ? "character-quick-view-description" : undefined}
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      className="m-auto max-h-[96vh] w-[calc(100vw-0.75rem)] max-w-[68rem] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl shadow-black/60 sm:max-h-[88vh] sm:w-[calc(100vw-2rem)]"
    >
      <div className="relative grid max-h-[96vh] overflow-y-auto sm:max-h-[88vh] md:grid-cols-[minmax(19rem,0.4fr)_minmax(0,0.6fr)] md:overflow-hidden">
        <button type="button" onClick={close} aria-label="Close character preview" className="archive-focus absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full border border-zinc-700 bg-zinc-950/85 text-lg text-zinc-300 shadow-lg backdrop-blur hover:bg-zinc-800 hover:text-zinc-50">×</button>

        <div className="relative min-h-[22rem] bg-zinc-950 md:min-h-[min(78vh,42rem)]">
          {character ? <CharacterAvatar name={character.name} src={character.avatarUrl} className="absolute inset-0 h-full w-full rounded-none ring-0" /> : <div className="absolute inset-0 animate-pulse bg-zinc-900" />}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/75 via-transparent to-zinc-950/10 md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-zinc-950/25" />
          {character && <div className="absolute bottom-4 left-4 right-4 flex flex-wrap items-end justify-between gap-2 md:hidden"><div className="flex flex-wrap gap-1.5">{character.sources.map((source) => <SourceBadge key={`${source.platform}-${source.sourceUrl}`} platform={source.platform} />)}</div><StatusBadge status={character.status} /></div>}
        </div>

        <div className="flex min-h-0 flex-col md:max-h-[88vh]">
          {character ? (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-7 sm:pb-7 sm:pt-8">
                <div className="hidden flex-wrap items-center gap-2 md:flex">{character.sources.map((source) => <SourceBadge key={`${source.platform}-${source.sourceUrl}`} platform={source.platform} />)}<StatusBadge status={character.status} /></div>
                <p className="archive-eyebrow mt-1 md:mt-5">Character preview</p>
                <h2 id="character-quick-view-title" className="mt-2 break-words text-2xl font-semibold leading-tight tracking-[-0.035em] text-zinc-50 sm:text-3xl">{character.name}</h2>
                <p className="mt-2 text-sm text-zinc-500">by {creators.length > 0 ? creators.join(", ") : "Unknown creator"}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">{character.tags.map((tag) => <span key={tag.slug} className="archive-chip">{tag.name}</span>)}{character.tags.length === 0 && <span className="text-xs text-zinc-600">No tags</span>}</div>
                <div id="character-quick-view-description" className="mt-5 border-l-2 border-[var(--accent-border)] pl-4"><p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{character.description ?? "No description provided."}</p></div>
                <dl className="mt-6 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-3"><dt className="text-zinc-600">Sources</dt><dd className="mt-1 font-semibold text-zinc-300">{character.sources.length}</dd></div><div className="rounded-lg border border-zinc-800 bg-zinc-900/45 p-3"><dt className="text-zinc-600">Last updated</dt><dd className="mt-1 font-semibold text-zinc-300">{formatDate(character.updatedAt)}</dd></div></dl>
                {firstSource && <div className="mt-5 border-t border-zinc-800 pt-4"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Original source</p><SourceLinkActions sourceUrl={firstSource.sourceUrl} /></div>}
              </div>
              <div className="flex flex-col-reverse gap-2 border-t border-zinc-800 bg-zinc-950/95 px-5 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-7"><button type="button" onClick={close} className="archive-button-secondary archive-focus">Close</button><Link href={`/characters/${character.id}`} className="archive-button-primary archive-focus">View full record <span aria-hidden="true">→</span></Link></div>
            </>
          ) : (
            <div className="flex min-h-[22rem] flex-1 items-center justify-center px-6 py-12 text-center"><div>{loading ? <><p className="archive-eyebrow">Loading</p><h2 id="character-quick-view-title" className="mt-2 text-lg font-semibold text-zinc-200">Loading character preview…</h2></> : <><p className="archive-eyebrow">Unavailable</p><h2 id="character-quick-view-title" className="mt-2 text-lg font-semibold text-zinc-200">Character preview unavailable</h2><p className="mt-2 text-sm text-zinc-500">{error ?? "This record could not be loaded."}</p><button type="button" onClick={close} className="archive-button-secondary archive-focus mt-5">Close</button></>}</div></div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
