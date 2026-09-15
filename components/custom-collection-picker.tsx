"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CollectionIcon } from "./collection-icon";
import { useToast } from "./toast-provider";
import { sanitizeToastError } from "./toast-utils";
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
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [memberships, setMemberships] = useState<CharacterCollectionMembership[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [isAnyMember, setIsAnyMember] = useState(false);
  const [portalNode, setPortalNode] = useState<Element | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const handleClose = useCallback(() => {
    setOpen(false);
    setPortalNode(null);
    triggerRef.current?.focus();
  }, []);

  function handleToggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next) {
        setLoading(true);
        setError(null);
        setCreating(false);
        setNewCollectionName("");
        setCreateError(null);
        const node =
          triggerRef.current?.closest("dialog") ??
          (typeof document !== "undefined" ? document.body : null);
        setPortalNode(node);
      } else {
        setPortalNode(null);
      }
      return next;
    });
  }

  // Viewport-aware positioning algorithm (direct DOM manipulation for performance & clean effects)
  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !popoverRef.current) return;
    const popover = popoverRef.current;

    if (window.innerWidth <= 640) {
      popover.style.top = "";
      popover.style.left = "";
      popover.style.width = "";
      popover.style.maxHeight = "";
      popover.style.visibility = "visible";
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();

    // If trigger button is detached or scrolled completely out of viewport view:
    if (
      triggerRect.width === 0 ||
      triggerRect.height === 0 ||
      triggerRect.bottom < 0 ||
      triggerRect.top > window.innerHeight
    ) {
      setOpen(false);
      return;
    }

    // Check if trigger is scrolled outside any ancestor scroll container
    let parent = triggerRef.current.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const style = window.getComputedStyle(parent);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        const parentRect = parent.getBoundingClientRect();
        if (
          triggerRect.bottom < parentRect.top ||
          triggerRect.top > parentRect.bottom
        ) {
          setOpen(false);
          return;
        }
      }
      parent = parent.parentElement;
    }

    const popoverRect = popover.getBoundingClientRect();

    const MARGIN = 12;
    const GAP = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const popoverWidth = Math.min(popoverRect.width || 256, viewportWidth - MARGIN * 2);
    const popoverHeight = popoverRect.height || 260;

    // Vertical calculations: choose between below vs above trigger
    const spaceBelow = viewportHeight - triggerRect.bottom - GAP - MARGIN;
    const spaceAbove = triggerRect.top - GAP - MARGIN;

    let top: number;
    let maxHeight: number;

    if (spaceBelow >= popoverHeight || spaceBelow >= spaceAbove) {
      // Place below trigger
      top = triggerRect.bottom + GAP;
      maxHeight = Math.max(160, spaceBelow);
    } else {
      // Flip above trigger
      top = triggerRect.top - GAP - popoverHeight;
      maxHeight = Math.max(160, spaceAbove);
    }

    // Clamp vertical to ensure margin from both edges
    if (top < MARGIN) {
      top = MARGIN;
    }
    if (top + popoverHeight > viewportHeight - MARGIN) {
      top = Math.max(MARGIN, viewportHeight - popoverHeight - MARGIN);
    }

    // Horizontal calculations: preferred right-aligned to trigger
    let left = triggerRect.right - popoverWidth;

    // If clipping left viewport edge (e.g. cards in column 1):
    if (left < MARGIN) {
      // Align to left of trigger
      left = triggerRect.left;
    }

    // Clamp horizontal within viewport bounds
    if (left < MARGIN) {
      left = MARGIN;
    }
    if (left + popoverWidth > viewportWidth - MARGIN) {
      left = Math.max(MARGIN, viewportWidth - popoverWidth - MARGIN);
    }

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.width = `${Math.round(popoverWidth)}px`;
    popover.style.maxHeight = `${Math.round(maxHeight)}px`;
    popover.style.visibility = "visible";
  }, []);

  // Update position synchronously before browser paint
  useLayoutEffect(() => {
    if (open) {
      updatePosition();
    }
  }, [open, updatePosition]);

  // Listen to resize, scroll (capturing internal scroll containers like Quick View), and ResizeObserver
  useEffect(() => {
    if (!open) return;

    function handleScrollOrResize() {
      updatePosition();
    }

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    let observer: ResizeObserver | null = null;
    if (popoverRef.current && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        updatePosition();
      });
      observer.observe(popoverRef.current);
    }

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      observer?.disconnect();
    };
  }, [open, updatePosition]);

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

  // Focus first element on open
  useEffect(() => {
    if (open && popoverRef.current) {
      const firstFocusable = popoverRef.current.querySelector<HTMLElement>(
        'input[type="checkbox"], input[type="text"], button:not([aria-label="Close collections menu"])'
      );
      if (firstFocusable) {
        firstFocusable.focus();
      } else {
        const closeBtn = popoverRef.current.querySelector<HTMLElement>('button[aria-label="Close collections menu"]');
        closeBtn?.focus();
      }
    }
  }, [open, loading]);

  // Handle outside click and Escape key with focus restoration
  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
      }
    }

    function handlePointerDown(event: PointerEvent | MouseEvent) {
      const target = event.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
        setPortalNode(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open, handleClose]);

  // Trap focus inside popover with Tab / Shift+Tab
  function handlePopoverKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Tab") {
      const focusable = popoverRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
  }

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

      // Toast feedback on confirmed server response with coalesceKey
      toast.success(
        nextIsMember ? `Added to "${collectionName}"` : `Removed from "${collectionName}"`,
        { coalesceKey: `col-${collectionId}-${characterId}` }
      );
    } catch (err) {
      // Rollback
      setMemberships((prev) =>
        prev.map((m) => (m.collectionId === collectionId ? { ...m, isMember: currentIsMember } : m))
      );
      setIsAnyMember(currentIsMember || memberships.some((m) => m.collectionId !== collectionId && m.isMember));
      setError(err instanceof Error ? err.message : "Failed to update collection.");

      toast.error(
        sanitizeToastError(err, "Couldn't update collection. Please try again."),
        { coalesceKey: `col-${collectionId}-${characterId}` }
      );
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

      toast.success(`Collection "${collection.name}" created`);
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

      {open &&
        portalNode &&
        createPortal(
          <>
            <div
              className="custom-collection-picker-backdrop fixed inset-0 z-[59] bg-black/60 backdrop-blur-sm sm:hidden"
              onClick={handleClose}
              aria-hidden="true"
            />
            <div
              ref={popoverRef}
              role="dialog"
              aria-label="Add to collection"
              onKeyDown={handlePopoverKeyDown}
              style={{ visibility: "hidden" }}
              className="custom-collection-picker-popover archive-surface fixed z-[60] w-64 rounded-xl border border-zinc-800 p-3 shadow-2xl shadow-black/80 flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-zinc-800/80 pb-2 mb-2 shrink-0">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-300">
                  Add to Collection
                </h4>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close collections menu"
                  className="text-zinc-500 hover:text-zinc-200 text-sm leading-none px-1 py-0.5 rounded archive-focus"
                >
                  ×
                </button>
              </div>

              {error && (
                <p className="text-xs text-red-400 mb-2 px-1 shrink-0" role="alert">
                  {error}
                </p>
              )}

              {loading ? (
                <div className="py-4 text-center text-xs text-zinc-500 animate-pulse">
                  Loading collections…
                </div>
              ) : (
                <>
                  <div className="custom-collection-picker-list max-h-48 overflow-y-auto space-y-0.5 overscroll-contain flex-1 min-h-0">
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

                  <div className="border-t border-zinc-800/80 pt-2 mt-2 shrink-0">
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
          </>,
          portalNode
        )}
    </div>
  );
}
