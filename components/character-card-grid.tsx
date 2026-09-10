"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CharacterCardItem } from "@/src/lib/characters/browse";
import { CharacterLibraryCard } from "./character-library-card";
import { CharacterQuickViewHost, clearQuickViewCache } from "./character-quick-view-host";
import { useCharacterCollections } from "./character-collections-provider";

export function CharacterCardGrid({
  characters,
  className = "dense-character-grid",
  selectable = false,
  selection,
  enableBulkDelete = false,
  onBulkDeleteSuccess,
}: {
  characters: CharacterCardItem[];
  className?: string;
  selectable?: boolean;
  selection?: {
    selectedIds: readonly string[];
    onChange: (characterId: string, selected: boolean) => void;
  };
  enableBulkDelete?: boolean;
  onBulkDeleteSuccess?: (deletedCount: number) => void;
}) {
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cartFeedback, setCartFeedback] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const collections = useCharacterCollections();
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const pageIds = characters.map((character) => character.id);
  const activeSelectedIds = selection?.selectedIds ?? selectedIds;
  const cardsSelectable = selectable || Boolean(selection);
  const canShowBulkDelete = enableBulkDelete && collections.role === "ADMIN";

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
      {selectable && activeSelectedIds.length > 0 && (
        <div className="character-selection-toolbar" role="region" aria-label="Character selection">
          <p><strong>{activeSelectedIds.length}</strong> selected</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => setSelectedIds(selectCharacterPage(pageIds))} className="archive-focus">Select page</button>
            <button type="button" onClick={() => { setSelectedIds([]); setCartFeedback(null); }} className="archive-focus">Deselect all</button>
            <button
              type="button"
              disabled={activeSelectedIds.some((id) => collections.isPending("cart", id))}
              onClick={() => void addSelectedToCart()}
              className="archive-focus"
            >Add selected to Cart</button>
            {canShowBulkDelete && (
              <button
                ref={deleteTriggerRef}
                type="button"
                onClick={() => setDeleteConfirmOpen(true)}
                className="character-selection-delete-button archive-focus"
              >
                Delete characters
              </button>
            )}
          </div>
          {cartFeedback && <p className="character-selection-feedback" role="status">{cartFeedback}</p>}
        </div>
      )}
      {selectable && activeSelectedIds.length === 0 && (
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
      {deleteConfirmOpen && (
        <BulkDeleteConfirmationDialog
          characterIds={activeSelectedIds}
          characters={characters}
          onClose={() => {
            setDeleteConfirmOpen(false);
          }}
          onSuccess={(deletedCount) => {
            activeSelectedIds.forEach(clearQuickViewCache);
            setSelectedIds([]);
            setDeleteConfirmOpen(false);
            onBulkDeleteSuccess?.(deletedCount);
          }}
        />
      )}
    </>
  );
}

export function BulkDeleteConfirmationDialog({
  characterIds,
  characters,
  onClose,
  onSuccess,
}: {
  characterIds: readonly string[];
  characters: readonly CharacterCardItem[];
  onClose: () => void;
  onSuccess: (deletedCount: number) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const count = characterIds.length;
  const nameMap = useMemo(() => new Map(characters.map((c) => [c.id, c.name])), [characters]);
  const selectedNames = useMemo(() => characterIds.map((id) => nameMap.get(id) ?? id), [characterIds, nameMap]);
  const previewNames = selectedNames.slice(0, 5);
  const remainingCount = selectedNames.length - previewNames.length;

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        if (!dialogRef.current) return;
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [onClose]);

  async function handleConfirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch("/api/characters/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ characterIds }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { error?: { message?: string } }).error?.message ?? "Failed to delete characters.",
        );
      }
      const data = (await response.json()) as { deletedCount: number };
      onSuccess(data.deletedCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete characters.");
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !deleting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-delete-title"
        aria-describedby="bulk-delete-description"
        className="archive-panel w-full max-w-md p-5 shadow-2xl shadow-black/70 sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="archive-eyebrow">Archive Management</p>
            <h2 id="bulk-delete-title" className="mt-1.5 text-base font-semibold text-zinc-100 sm:text-lg">
              Delete {count} {count === 1 ? "character" : "characters"}?
            </h2>
            <p id="bulk-delete-description" className="mt-2 text-xs leading-5 text-zinc-400">
              The selected {count === 1 ? "character" : "characters"} will be soft-deleted and removed from normal archive views. Administrators can review or restore deleted characters at any time from Settings.
            </p>
          </div>
          <button
            type="button"
            disabled={deleting}
            onClick={onClose}
            aria-label="Close dialog"
            className="archive-focus rounded-md px-2 py-1 text-lg text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ×
          </button>
        </div>

        {selectedNames.length > 0 && (
          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-300">
            <p className="mb-2 text-[0.65rem] font-semibold uppercase tracking-wider text-zinc-500">
              Characters to delete
            </p>
            <ul className="space-y-1">
              {previewNames.map((name, i) => (
                <li key={i} className="truncate font-medium text-zinc-200">
                  {name}
                </li>
              ))}
              {remainingCount > 0 && (
                <li className="italic text-zinc-500">+{remainingCount} more</li>
              )}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-red-400">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-zinc-800 pt-4">
          <button
            ref={cancelButtonRef}
            type="button"
            disabled={deleting}
            onClick={onClose}
            className="archive-button-secondary archive-focus text-xs"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleConfirmDelete()}
            className="archive-focus rounded-lg border border-red-500/40 bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : `Delete ${count} ${count === 1 ? "character" : "characters"}`}
          </button>
        </div>
      </div>
    </div>
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
