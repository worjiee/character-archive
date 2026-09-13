"use client";

import { useEffect, useRef, useState } from "react";
import { CollectionIcon } from "./collection-icon";
import type { CharacterCollectionMembership } from "@/src/lib/collections/custom-collections";

interface CustomCollectionPickerProps {
  characterId: string;
  characterName: string;
  variant?: "icon" | "labeled";
  className?: string;
  onMembershipChange?: (collectionId: string, isMember: boolean) => void;
}

export function CustomCollectionPicker({
  characterId,
  characterName,
  variant = "icon",
  className = "",
  onMembershipChange,
}: CustomCollectionPickerProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memberships, setMemberships] = useState<CharacterCollectionMembership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [isAnyMember, setIsAnyMember] = useState(false);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  function handleToggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setLoading(true);
        setError(null);
        setCreating(false);
        setNewCollectionName("");
        setCreateError(null);
      }
      return next;
    });
  }

  // Load memberships when picker opens
  useEffect(() => {
    if (!open) return;

    let isSubscribed = true;

    fetch(`/api/custom-collections/character/${encodeURIComponent(characterId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load collections.");
        return res.json();
      })
      .then((data: { memberships: CharacterCollectionMembership[] }) => {
        if (isSubscribed) {
          setMemberships(data.memberships);
          setIsAnyMember(data.memberships.some((m) => m.isMember));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isSubscribed) {
          setError(err instanceof Error ? err.message : "Error loading collections.");
          setLoading(false);
        }
      });

    return () => {
      isSubscribed = false;
    };
  }, [open, characterId]);

  // Handle outside click and Escape key
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    function handleOutsideClick(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  // Focus input when creating mode activates
  useEffect(() => {
    if (creating) {
      createInputRef.current?.focus();
    }
  }, [creating]);

  async function handleToggle(collectionId: string, currentIsMember: boolean, collectionName: string) {
    const nextIsMember = !currentIsMember;

    // Optimistic update
    setMemberships((prev) =>
      prev.map((m) => (m.collectionId === collectionId ? { ...m, isMember: nextIsMember } : m))
    );
    const updatedAny = nextIsMember || memberships.some((m) => m.collectionId !== collectionId && m.isMember);
    setIsAnyMember(updatedAny);
    setAnnouncement(
      `${characterName} ${nextIsMember ? "added to" : "removed from"} ${collectionName}.`
    );

    try {
      const response = await fetch(
        `/api/custom-collections/${encodeURIComponent(collectionId)}/characters/${encodeURIComponent(characterId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ present: nextIsMember }),
        }
      );

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to update collection.");
      }

      onMembershipChange?.(collectionId, nextIsMember);
    } catch (err) {
      // Rollback
      setMemberships((prev) =>
        prev.map((m) => (m.collectionId === collectionId ? { ...m, isMember: currentIsMember } : m))
      );
      setIsAnyMember(currentIsMember || memberships.some((m) => m.collectionId !== collectionId && m.isMember));
      setError(err instanceof Error ? err.message : "Failed to update collection.");
    }
  }

  async function handleCreateCollection(event: React.FormEvent) {
    event.preventDefault();
    const name = newCollectionName.trim();
    if (!name) return;

    setCreateError(null);
    try {
      // 1. Create collection
      const createRes = await fetch("/api/custom-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to create collection.");
      }

      const { collection } = await createRes.json();

      // 2. Immediately add current character (Owner Decision #9)
      const addRes = await fetch(
        `/api/custom-collections/${encodeURIComponent(collection.id)}/characters/${encodeURIComponent(characterId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ present: true }),
        }
      );

      if (!addRes.ok) {
        const body = await addRes.json().catch(() => ({}));
        throw new Error(body.error?.message || "Collection created, but failed to add character.");
      }

      const newMembership: CharacterCollectionMembership = {
        collectionId: collection.id,
        collectionName: collection.name,
        isMember: true,
      };

      setMemberships((prev) => [...prev, newMembership].sort((a, b) => a.collectionName.localeCompare(b.collectionName)));
      setIsAnyMember(true);
      setCreating(false);
      setNewCollectionName("");
      setAnnouncement(`${characterName} added to new collection ${collection.name}.`);
      onMembershipChange?.(collection.id, true);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create collection.");
    }
  }

  const isLabeled = variant === "labeled";

  return (
    <div className={`relative inline-block ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Add ${characterName} to collections`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={isLabeled ? "Collections" : `Add ${characterName} to collections`}
        data-collection="custom"
        data-active={isAnyMember || open}
        onClick={handleToggleOpen}
        className={
          isLabeled
            ? "character-collection-toggle character-collection-toggle-labeled archive-focus"
            : "character-collection-toggle custom-collection-card-trigger archive-focus"
        }
      >
        <CollectionIcon name="collection" active={isAnyMember || open} />
        {isLabeled && <span className="character-collection-toggle-label">Collections</span>}
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Add to collection"
          className="custom-collection-picker-popover archive-surface fixed sm:absolute z-50 rounded-xl border border-zinc-800 p-3 shadow-2xl shadow-black/80"
        >
          <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 mb-2">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-300">
              Add to Collection
            </h4>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
              aria-label="Close collections menu"
              className="text-zinc-500 hover:text-zinc-200 text-sm leading-none px-1 py-0.5 rounded archive-focus"
            >
              ×
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-400 mb-2 px-1" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <div className="py-4 text-center text-xs text-zinc-500 animate-pulse">
              Loading collections…
            </div>
          ) : (
            <>
              <div className="custom-collection-picker-list max-h-48 overflow-y-auto space-y-0.5 overscroll-contain">
                {memberships.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-2 px-1 text-center">
                    No collections created yet.
                  </p>
                ) : (
                  memberships.map((membership) => {
                    const checkboxId = `col-pick-${characterId}-${membership.collectionId}`;
                    return (
                      <label
                        key={membership.collectionId}
                        htmlFor={checkboxId}
                        className="custom-collection-picker-option flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer hover:bg-zinc-800/60 transition-colors"
                      >
                        <span className="truncate text-zinc-300 font-medium select-none">
                          {membership.collectionName}
                        </span>
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={membership.isMember}
                          onChange={() =>
                            handleToggle(
                              membership.collectionId,
                              membership.isMember,
                              membership.collectionName
                            )
                          }
                          className="h-4 w-4 rounded border-zinc-700 bg-zinc-900 text-violet-500 focus:ring-violet-500/50"
                        />
                      </label>
                    );
                  })
                )}
              </div>

              <div className="border-t border-zinc-800/80 pt-2 mt-2">
                {creating ? (
                  <form onSubmit={handleCreateCollection} className="space-y-1.5">
                    <input
                      ref={createInputRef}
                      type="text"
                      value={newCollectionName}
                      onChange={(e) => setNewCollectionName(e.target.value)}
                      placeholder="Collection name..."
                      maxLength={50}
                      className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                    />
                    {createError && (
                      <p className="text-[10px] text-red-400 px-0.5">{createError}</p>
                    )}
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setCreating(false);
                          setCreateError(null);
                        }}
                        className="px-2 py-1 text-[11px] rounded text-zinc-400 hover:text-zinc-200 archive-focus"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!newCollectionName.trim()}
                        className="px-2.5 py-1 text-[11px] font-medium rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 archive-focus"
                      >
                        Create
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-violet-400 hover:text-violet-300 font-medium rounded-lg hover:bg-violet-950/20 archive-focus"
                  >
                    <span>+</span>
                    <span>Create new collection</span>
                  </button>
                )}
              </div>
            </>
          )}

          <span className="sr-only" role="status" aria-live="polite">
            {announcement}
          </span>
        </div>
      )}
    </div>
  );
}
