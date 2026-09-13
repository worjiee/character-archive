"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ContinueBrowsingItem } from "../src/lib/history/service";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";
import { CharacterQuickViewHost } from "./character-quick-view-host";
import { relativeActivityLabel } from "../src/lib/home/relative-activity";
import { useLiveNow } from "./live-time-provider";

export function ContinueBrowsingShelf({
  items,
}: {
  items: ContinueBrowsingItem[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const now = useLiveNow();

  if (!items || items.length === 0) {
    return null;
  }

  function handleOpen(characterId: string, trigger: HTMLButtonElement) {
    openerRef.current = trigger;
    setSelectedId(characterId);
  }

  function handleClose() {
    setSelectedId(null);
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }

  return (
    <section className="mt-6 mb-2" aria-labelledby="continue-browsing-heading">
      <div className="flex items-center justify-between gap-2 pb-2.5">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-zinc-500 font-mono text-xs">↺</span>
          <h2
            id="continue-browsing-heading"
            className="archive-eyebrow tracking-wider text-zinc-400 font-semibold"
          >
            CONTINUE BROWSING
          </h2>
        </div>
        <Link
          href="/history"
          className="archive-focus inline-flex items-center gap-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors py-1 px-1.5 rounded-sm"
        >
          <span>View history</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <div
        className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin -mx-4 px-4 sm:mx-0 sm:px-0 sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 sm:overflow-x-visible sm:pb-0"
        role="list"
        aria-label="Recently viewed characters"
      >
        {items.map((item) => {
          const { character, lastViewedAt } = item;
          const platform = character.sources[0]?.platform;
          const relativeTime = relativeActivityLabel(lastViewedAt, now);

          return (
            <div
              key={character.id}
              role="listitem"
              className="group relative flex-shrink-0 w-[140px] sm:w-auto rounded-lg border border-zinc-800/80 bg-zinc-900/60 p-2 transition duration-200 hover:border-zinc-700 hover:bg-zinc-900"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`Preview ${character.name}`}
                onClick={(e) => handleOpen(character.id, e.currentTarget)}
                className="archive-focus flex w-full flex-col text-left"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-zinc-950">
                  <CharacterAvatar
                    name={character.name}
                    src={character.avatarUrl}
                    className="h-full w-full rounded-none ring-0 transition duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-zinc-950/90 to-transparent" />
                  {platform && (
                    <div className="pointer-events-none absolute bottom-1.5 left-1.5">
                      <SourceBadge platform={platform} variant="compact" />
                    </div>
                  )}
                </div>

                <div className="mt-2 min-w-0">
                  <p className="truncate text-xs font-medium text-zinc-200 group-hover:text-violet-300">
                    {character.name}
                  </p>
                  <p className="font-interface mt-0.5 text-[0.62rem] text-zinc-500">
                    {relativeTime}
                  </p>
                </div>
              </button>

              <div className="mt-1 flex items-center justify-between border-t border-zinc-800/50 pt-1">
                <Link
                  href={`/characters/${character.id}`}
                  className="archive-focus inline-flex min-h-[32px] sm:min-h-[28px] items-center text-[0.68rem] text-zinc-400 hover:text-zinc-200 transition-colors"
                  aria-label={`Full record for ${character.name}`}
                >
                  Record →
                </Link>
              </div>
            </div>
          );
        })}
      </div>

      {selectedId && (
        <CharacterQuickViewHost
          characterId={selectedId}
          onClose={handleClose}
        />
      )}
    </section>
  );
}