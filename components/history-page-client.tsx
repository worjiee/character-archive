"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HistoryItem, PaginatedHistoryResult } from "../src/lib/history/service";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge, TokenBadge, StatusBadge } from "./character-badges";
import { CharacterQuickViewHost } from "./character-quick-view-host";
import { relativeActivityLabel } from "../src/lib/home/relative-activity";
import { useLiveNow } from "./live-time-provider";

export type HistoryBucket = "Today" | "Yesterday" | "Earlier this week" | "Older";

const emptySubscribe = () => () => {};
function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function groupHistoryByDate(items: HistoryItem[], now: Date = new Date()): { bucket: HistoryBucket; items: HistoryItem[] }[] {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

  const buckets: Record<HistoryBucket, HistoryItem[]> = {
    "Today": [],
    "Yesterday": [],
    "Earlier this week": [],
    "Older": [],
  };

  for (const item of items) {
    const time = new Date(item.lastViewedAt).getTime();
    if (time >= todayStart) {
      buckets["Today"].push(item);
    } else if (time >= yesterdayStart) {
      buckets["Yesterday"].push(item);
    } else if (time >= weekStart) {
      buckets["Earlier this week"].push(item);
    } else {
      buckets["Older"].push(item);
    }
  }

  const order: HistoryBucket[] = ["Today", "Yesterday", "Earlier this week", "Older"];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ bucket: key, items: buckets[key] }));
}

export function HistoryPageClient({
  initialData,
}: {
  initialData: PaginatedHistoryResult;
}) {
  const router = useRouter();
  const [items, setItems] = useState<HistoryItem[]>(initialData.items);
  const [totalCount, setTotalCount] = useState<number>(initialData.totalCount);
  const [prevInitialData, setPrevInitialData] = useState(initialData);

  if (prevInitialData !== initialData) {
    setPrevInitialData(initialData);
    setItems(initialData.items);
    setTotalCount(initialData.totalCount);
  }

  const [selectedQuickViewId, setSelectedQuickViewId] = useState<string | null>(null);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const mounted = useIsMounted();

  const clearButtonRef = useRef<HTMLButtonElement | null>(null);
  const modalDialogRef = useRef<HTMLDialogElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const liveNow = useLiveNow();

  // Manage native modal dialog for Clear All History
  useEffect(() => {
    const dialog = modalDialogRef.current;
    if (!dialog) return;

    if (clearModalOpen) {
      if (!dialog.open) {
        dialog.showModal();
        confirmButtonRef.current?.focus();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
      clearButtonRef.current?.focus();
    }
  }, [clearModalOpen]);

  const groups = useMemo(() => {
    const refDate = mounted ? new Date() : new Date("2026-09-14T00:00:00Z");
    return groupHistoryByDate(items, refDate);
  }, [items, mounted]);

  async function handleRemove(characterId: string) {
    setItems((prev) => prev.filter((i) => i.character.id !== characterId));
    setTotalCount((prev) => Math.max(0, prev - 1));

    try {
      await fetch(`/api/history/characters/${encodeURIComponent(characterId)}`, {
        method: "DELETE",
      });
    } catch {
      // Best effort removal
    }
  }

  async function handleClearAll() {
    setIsClearing(true);
    try {
      const res = await fetch("/api/history", { method: "DELETE" });
      if (res.ok) {
        setItems([]);
        setTotalCount(0);
        setClearModalOpen(false);
        router.refresh();
      }
    } catch {
      // Best effort
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl pb-16">
      {/* Header */}
      <header className="border-b border-zinc-800/80 pb-6 pt-2">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="archive-eyebrow">PRIVATE ARCHIVE</p>
            <h1 className="mt-1 text-2xl font-bold uppercase tracking-[-0.025em] text-zinc-50 sm:text-3xl">
              Viewing History
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              Characters you have recently opened in Quick View or Full Record.
            </p>
          </div>

          {items.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                ref={clearButtonRef}
                type="button"
                onClick={() => setClearModalOpen(true)}
                className="archive-focus min-h-[44px] sm:min-h-[38px] rounded-md border border-rose-900/60 bg-rose-950/30 px-3.5 py-2 text-xs font-semibold text-rose-300 transition-colors hover:border-rose-700 hover:bg-rose-950/60"
              >
                Clear all history
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      {items.length === 0 ? (
        <div className="mt-12 rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-8 text-center">
          <p className="archive-eyebrow">NO VIEWING HISTORY</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-200">
            No viewing history yet
          </h2>
          <p className="mt-1.5 text-sm text-zinc-400 max-w-md mx-auto">
            Characters you explore in Quick View or Full Record will appear here for easy return.
          </p>
          <div className="mt-6">
            <Link
              href="/characters"
              className="archive-focus inline-flex min-h-[44px] items-center justify-center rounded-md bg-violet-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              Browse Characters
            </Link>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map(({ bucket, items: groupItems }) => (
            <section key={bucket} aria-labelledby={`bucket-${bucket.replace(/\s+/g, "-")}`}>
              <div className="flex items-center gap-2 border-b border-zinc-800/60 pb-2">
                <span className="font-mono text-xs text-violet-400" aria-hidden="true">■</span>
                <h2
                  id={`bucket-${bucket.replace(/\s+/g, "-")}`}
                  className="font-interface text-xs font-bold uppercase tracking-wider text-zinc-300"
                  suppressHydrationWarning
                >
                  {bucket}
                </h2>
                <span className="text-xs text-zinc-500 font-mono">({groupItems.length})</span>
              </div>

              <div className="mt-3 divide-y divide-zinc-800/50 rounded-lg border border-zinc-800/60 bg-zinc-900/40">
                {groupItems.map((item) => {
                  const { character, lastViewedAt } = item;
                  const platform = character.sources[0]?.platform;
                  const creatorName = character.sources[0]?.creatorName;
                  const relativeTime = relativeActivityLabel(lastViewedAt, liveNow);

                  return (
                    <article
                      key={character.id}
                      className="flex flex-col gap-3 p-3 transition-colors hover:bg-zinc-800/30 sm:flex-row sm:items-center sm:justify-between"
                    >
                      {/* Left: Thumbnail & Info */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <button
                          type="button"
                          aria-label={`Preview ${character.name}`}
                          onClick={() => setSelectedQuickViewId(character.id)}
                          className="archive-focus relative h-16 w-12 flex-shrink-0 overflow-hidden rounded bg-zinc-950 text-left group"
                        >
                          <CharacterAvatar
                            name={character.name}
                            src={character.avatarUrl}
                            className="h-full w-full rounded-none ring-0 transition duration-200 group-hover:scale-105"
                          />
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/characters/${character.id}`}
                              className="archive-focus truncate text-sm font-semibold text-zinc-100 hover:text-violet-300 transition-colors"
                            >
                              {character.name}
                            </Link>
                            {character.status !== "ACTIVE" && (
                              <StatusBadge status={character.status} />
                            )}
                          </div>

                          <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-zinc-400">
                            {platform && (
                              <SourceBadge platform={platform} variant="compact" />
                            )}
                            {creatorName && (
                              <span className="truncate">by {creatorName}</span>
                            )}
                            {character.tokenCount != null && (
                              <TokenBadge tokenCount={character.tokenCount} variant="compact" />
                            )}
                            <span className="text-zinc-600">•</span>
                            <span className="text-[0.7rem] text-zinc-500 font-interface">
                              {relativeTime}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          onClick={() => setSelectedQuickViewId(character.id)}
                          className="archive-focus min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-0 inline-flex items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
                        >
                          Quick View
                        </button>

                        <Link
                          href={`/characters/${character.id}`}
                          className="archive-focus min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-0 inline-flex items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/60 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 hover:text-white transition-colors"
                        >
                          Record
                        </Link>

                        <button
                          type="button"
                          aria-label={`Remove ${character.name} from history`}
                          onClick={() => handleRemove(character.id)}
                          className="archive-focus min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-md text-zinc-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
                          title="Remove from history"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                            aria-hidden="true"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}

          {/* Pagination */}
          {initialData.totalPages > 1 && (
            <nav
              aria-label="History pagination"
              className="mt-8 flex items-center justify-between border-t border-zinc-800/80 pt-4"
            >
              <div className="text-xs text-zinc-500 font-interface">
                Page {initialData.page} of {initialData.totalPages} ({totalCount} total)
              </div>
              <div className="flex items-center gap-2">
                {initialData.page > 1 ? (
                  <Link
                    href={`/history?page=${initialData.page - 1}`}
                    className="archive-focus min-h-[44px] min-w-[44px] sm:min-h-[36px] inline-flex items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
                  >
                    ‹ Previous
                  </Link>
                ) : (
                  <span className="min-h-[44px] min-w-[44px] sm:min-h-[36px] inline-flex items-center justify-center rounded-md border border-zinc-800/40 bg-zinc-900/30 px-3 py-1.5 text-xs font-medium text-zinc-600 cursor-not-allowed">
                    ‹ Previous
                  </span>
                )}

                {initialData.page < initialData.totalPages ? (
                  <Link
                    href={`/history?page=${initialData.page + 1}`}
                    className="archive-focus min-h-[44px] min-w-[44px] sm:min-h-[36px] inline-flex items-center justify-center rounded-md border border-zinc-700/60 bg-zinc-800/50 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white"
                  >
                    Next ›
                  </Link>
                ) : (
                  <span className="min-h-[44px] min-w-[44px] sm:min-h-[36px] inline-flex items-center justify-center rounded-md border border-zinc-800/40 bg-zinc-900/30 px-3 py-1.5 text-xs font-medium text-zinc-600 cursor-not-allowed">
                    Next ›
                  </span>
                )}
              </div>
            </nav>
          )}
        </div>
      )}

      {/* Quick View Host */}
      {selectedQuickViewId && (
        <CharacterQuickViewHost
          characterId={selectedQuickViewId}
          onClose={() => setSelectedQuickViewId(null)}
        />
      )}

      {/* Clear All Confirmation Modal */}
      <dialog
        ref={modalDialogRef}
        onCancel={() => setClearModalOpen(false)}
        className="fixed inset-0 z-50 m-auto max-w-md w-[calc(100%-2rem)] rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-zinc-100 shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
        aria-labelledby="clear-history-title"
        aria-describedby="clear-history-desc"
      >
        <h3 id="clear-history-title" className="text-lg font-bold text-zinc-100">
          Clear viewing history?
        </h3>
        <p id="clear-history-desc" className="mt-2 text-sm text-zinc-400">
          This will remove all characters from your viewing history and reset your Continue Browsing shelf. Characters in your archive, Favorites, and Collections will not be deleted.
        </p>
        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setClearModalOpen(false)}
            disabled={isClearing}
            className="archive-focus min-h-[44px] rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            onClick={handleClearAll}
            disabled={isClearing}
            className="archive-focus min-h-[44px] rounded-md bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500 transition-colors disabled:opacity-50"
          >
            {isClearing ? "Clearing..." : "Clear History"}
          </button>
        </div>
      </dialog>
    </div>
  );
}