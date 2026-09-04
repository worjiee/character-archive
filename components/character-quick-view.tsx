"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { CharacterQuickViewData } from "@/src/lib/characters/browse";
import { getSourceIdentity } from "../src/lib/sources/presentation";
import { lorebookDetailHref } from "./lorebook-library-utils";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge, StatusBadge } from "./character-badges";
import { CharacterCollectionActions } from "./character-collection-actions";
import { CharacterDownloadMenu, characterDownloadMenuResetKey } from "./character-download-menu";
import { showModalWhenClosed } from "./character-library-utils";
import { normalizeSourceProse } from "../src/lib/source-prose";
import { useCharacterCollections } from "./character-collections-provider";
import { clearQuickViewCache } from "./character-quick-view-host";

export interface QuickViewNavigationItem {
  id: string;
  name: string;
}

export function CharacterQuickView({
  characterId,
  character,
  loading,
  error,
  previousCharacter,
  nextCharacter,
  onPrevious,
  onNext,
  onClose,
}: {
  characterId: string;
  character: CharacterQuickViewData | null;
  loading: boolean;
  error: string | null;
  previousCharacter?: QuickViewNavigationItem;
  nextCharacter?: QuickViewNavigationItem;
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const creators = [...new Set(character?.sources.map((source) => source.creatorName).filter(Boolean) ?? [])];
  const { role } = useCharacterCollections();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const scrollY = window.scrollY;
    showModalWhenClosed(dialog);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      window.scrollTo(0, scrollY);
    };
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [characterId]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (deleteConfirmOpen) return;
      const direction = quickViewDirectionForKey(
        event.key,
        event.target,
        Boolean(previousCharacter && onPrevious),
        Boolean(nextCharacter && onNext),
      );
      if (!direction) return;
      event.preventDefault();
      if (direction === "previous") onPrevious?.();
      else onNext?.();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [deleteConfirmOpen, nextCharacter, onNext, onPrevious, previousCharacter]);

  function close() {
    dialogRef.current?.close();
  }

  async function handleDelete() {
    if (!character) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(character.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: { message?: string } }).error?.message ?? "Failed to delete character.");
      }
      clearQuickViewCache(character.id);
      setDeleteConfirmOpen(false);
      close();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete character.");
      setDeleting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="character-quick-view-title"
      aria-describedby={character ? "character-quick-view-description" : undefined}
      onClose={onClose}
      onCancel={(event) => handleQuickViewCancel(event, close)}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      className="character-quick-view-dialog"
    >
      <button
        type="button"
        aria-label={previousCharacter ? `Previous character: ${previousCharacter.name}` : "Previous character"}
        aria-keyshortcuts="ArrowLeft"
        disabled={!previousCharacter || !onPrevious}
        onClick={onPrevious}
        className="quick-view-nav-button quick-view-nav-previous archive-focus"
      ><span aria-hidden="true">‹</span></button>

      <div className="character-quick-view-shell" data-character-id={characterId}>
        <header className="character-quick-view-header">
          <div className="min-w-0">
            <h2 id="character-quick-view-title" className="character-quick-view-title">
              {character?.name ?? (loading ? "Loading character preview…" : "Character preview unavailable")}
            </h2>
            {character && (
              <>
                <div className="character-quick-view-byline">
                  <span className="archive-author-label">Author</span>
                  <span className="truncate">{creators.length > 0 ? creators.join(", ") : "Unknown creator"}</span>
                  <span aria-hidden="true" className="text-zinc-700">•</span>
                  <span>Updated {formatDate(character.updatedAt)}</span>
                </div>
                <p className="mt-1 text-[10px] text-zinc-500">
                  Added by {character.uploaderName}
                  {character.publishedAt ? ` · First published ${formatDate(character.publishedAt)}` : " · Not yet published"}
                </p>
              </>
            )}
          </div>
          <button type="button" onClick={close} aria-label="Close character preview" className="character-quick-view-close archive-focus">×</button>
        </header>

        {character ? (
          <>
            <div className="character-quick-view-main">
              <aside className="character-quick-view-artwork">
                <CharacterAvatar name={character.name} src={character.avatarUrl} className="absolute inset-0 h-full w-full rounded-none ring-0" />
                <div className="character-quick-view-artwork-shade" />
                <CharacterCollectionActions characterId={character.id} characterName={character.name} variant="quick-view" />
                <div className="character-quick-view-artwork-meta">
                  <div className="flex flex-wrap gap-1.5">{character.sources.slice(0, 3).map((source) => <SourceBadge key={`${source.platform}-${source.sourceUrl}`} platform={source.platform} />)}</div>
                  <StatusBadge status={character.status} />
                </div>
              </aside>

              <div ref={contentRef} className="character-quick-view-content">
                <section id="character-quick-view-description" className="quick-view-primary-section">
                  <h3>Description</h3>
                  <p className="quick-view-description-text">{normalizeSourceProse(character.description) ?? "No description provided."}</p>
                </section>

                <QuickViewTextSection title="Personality" value={character.personality} prominent />
                <div className="quick-view-definition-grid">
                  <QuickViewTextSection title="Scenario" value={character.scenario} />
                  <QuickViewTextSection title="Example dialogs" value={character.exampleDialogs} />
                </div>

                <section className="quick-view-content-section">
                  <div className="quick-view-section-heading"><h3>Greetings</h3><span>{character.greetingCount}</span></div>
                  {character.greetingPreview ? (
                    <div className="quick-view-greeting-preview">
                      <p>{character.greetingPreview.content}</p>
                      <span>{character.greetingPreview.source.creatorName ?? "Unknown creator"} · <SourceBadge platform={character.greetingPreview.source.platform} variant="compact" /></span>
                    </div>
                  ) : <p className="quick-view-empty-value">No visible greetings.</p>}
                </section>

                <section className="quick-view-content-section">
                  <div className="quick-view-section-heading"><h3>Tags</h3><span>{character.tagCount}</span></div>
                  <div className="quick-view-tag-strip">
                    {character.tags.map((tag) => <span key={tag.slug} className="archive-chip">{tag.name}</span>)}
                    {character.tagCount > character.tags.length && <span className="archive-chip" data-overflow="true">+{character.tagCount - character.tags.length}</span>}
                    {character.tagCount === 0 && <span className="quick-view-empty-value">No tags.</span>}
                  </div>
                </section>

                <section className="quick-view-content-section">
                  <div className="quick-view-section-heading"><h3>Lorebooks</h3><span>{character.lorebookCount} attached</span></div>
                  {character.lorebooks.length > 0 ? (
                    <div className="quick-view-lorebooks">
                      {character.lorebooks.map((lorebook) => <Link key={lorebook.id} href={lorebookDetailHref(lorebook.id)} className="archive-focus"><SourceBadge platform={lorebook.sourcePlatform} variant="compact" /><span className="truncate">{lorebook.title}</span><span aria-hidden="true">→</span></Link>)}
                      {character.lorebookCount > character.lorebooks.length && <span className="quick-view-overflow-note">+{character.lorebookCount - character.lorebooks.length} more on the full record</span>}
                    </div>
                  ) : <p className="quick-view-empty-value">No attached lorebooks.</p>}
                </section>

                <section className="quick-view-content-section">
                  <div className="quick-view-section-heading"><h3>Sources</h3><span>{character.sourceCount}</span></div>
                  <div className="quick-view-sources">
                    {character.sources.map((source) => (
                      <article key={`${source.platform}-${source.sourceUrl}`}>
                        <div><SourceBadge platform={source.platform} /><span className="truncate">{source.creatorName ?? "Unknown creator"}</span></div>
                        <p className="mt-1 text-[10px] text-zinc-600">Source added by {source.addedBy}</p>
                        <a href={source.sourceUrl} target="_blank" rel="noreferrer" aria-label={`Open original ${source.platform} source`}>Original source <span aria-hidden="true">↗</span></a>
                      </article>
                    ))}
                    {character.sourceCount > character.sources.length && <span className="quick-view-overflow-note">+{character.sourceCount - character.sources.length} more on the full record</span>}
                  </div>
                </section>
              </div>
            </div>

            <footer className="character-quick-view-actions">
              <Link href={`/characters/${character.id}`} className="archive-button-secondary archive-focus">View full record <span aria-hidden="true">→</span></Link>
              <CharacterDownloadMenu
                key={characterDownloadMenuResetKey(characterId)}
                characterId={character.id}
                archiveSource={character.sources[0] ? getSourceIdentity(character.sources[0].platform).label : "Character Archive"}
              />
              {role === "ADMIN" && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="archive-focus ml-auto rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete character"}
                </button>
              )}
            </footer>
          </>
        ) : loading ? (
          <div className="character-quick-view-main" aria-label="Loading character preview" aria-busy="true">
            <aside className="character-quick-view-artwork animate-pulse bg-zinc-900/50" />
            <div className="character-quick-view-content space-y-5 p-6">
              <div className="space-y-2">
                <div className="h-5 w-48 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-32 animate-pulse rounded bg-zinc-800/60" />
              </div>
              <div className="space-y-2 pt-2">
                <div className="h-3 w-full animate-pulse rounded bg-zinc-800/40" />
                <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-800/40" />
                <div className="h-3 w-4/6 animate-pulse rounded bg-zinc-800/40" />
              </div>
              <div className="flex gap-2 pt-4">
                <div className="h-6 w-16 animate-pulse rounded-full bg-zinc-800/60" />
                <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-800/60" />
                <div className="h-6 w-14 animate-pulse rounded-full bg-zinc-800/60" />
              </div>
            </div>
          </div>
        ) : (
          <div className="character-quick-view-state">
            <p className="archive-eyebrow">Unavailable</p>
            <p>{error ?? "This record could not be loaded."}</p>
          </div>
        )}
      </div>

      <button
        type="button"
        aria-label={nextCharacter ? `Next character: ${nextCharacter.name}` : "Next character"}
        aria-keyshortcuts="ArrowRight"
        disabled={!nextCharacter || !onNext}
        onClick={onNext}
        className="quick-view-nav-button quick-view-nav-next archive-focus"
      ><span aria-hidden="true">›</span></button>

      {deleteConfirmOpen && character && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="archive-surface max-w-sm rounded-xl border border-zinc-800 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100">Soft-delete {character.name}?</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              This character will be moved to Deleted status. It can be reviewed or restored by an Admin from Settings at any time.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteConfirmOpen(false)}
                className="archive-button-secondary archive-focus text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="archive-focus rounded-lg border border-red-500/40 bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </dialog>
  );
}

function QuickViewTextSection({ title, value, prominent = false }: { title: string; value: string | null; prominent?: boolean }) {
  const normalized = normalizeSourceProse(value);
  if (!normalized) return null;
  const expandable = isQuickViewProseExpandable(normalized);
  if (!expandable) {
    return (
      <section className={`quick-view-text-section quick-view-text-static${prominent ? " quick-view-personality-section" : ""}`}>
        <h3>{title}</h3>
        <p className="quick-view-text-preview">{normalized}</p>
      </section>
    );
  }
  return (
    <details className={`quick-view-text-section group${prominent ? " quick-view-personality-section" : ""}`}>
      <summary className="archive-focus">
        <span>{title}</span><span className="group-open:hidden">Expand</span><span className="hidden group-open:inline">Collapse</span>
        <span className="quick-view-text-preview">{normalized}</span>
      </summary>
      <div>{normalized}</div>
    </details>
  );
}

export function isQuickViewProseExpandable(value: string): boolean {
  return value.length > 320 || value.split("\n").length > 5;
}

export function quickViewDirectionForKey(
  key: string,
  target: EventTarget | null,
  canPrevious: boolean,
  canNext: boolean,
): "previous" | "next" | null {
  if (shouldIgnoreQuickViewArrowTarget(target)) return null;
  if (key === "ArrowLeft" && canPrevious) return "previous";
  if (key === "ArrowRight" && canNext) return "next";
  return null;
}

export function shouldIgnoreQuickViewArrowTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { tagName?: unknown; isContentEditable?: unknown; getAttribute?: (name: string) => string | null };
  const tagName = typeof candidate.tagName === "string" ? candidate.tagName.toUpperCase() : "";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tagName) || candidate.isContentEditable === true) return true;
  const role = candidate.getAttribute?.("role");
  return role ? ["combobox", "grid", "listbox", "menu", "slider", "spinbutton", "tree"].includes(role) : false;
}

export function handleQuickViewCancel(event: Pick<Event, "preventDefault">, close: () => void): void {
  event.preventDefault();
  close();
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
