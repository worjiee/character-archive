"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { UserCollectionItem } from "@/src/lib/collections/custom-collections";
import { useToast } from "./toast-provider";
import { sanitizeToastError } from "./toast-utils";

interface CollectionsIndexClientProps {
  initialCollections: UserCollectionItem[];
}

export function CollectionsIndexClient({ initialCollections }: CollectionsIndexClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [collections, setCollections] = useState<UserCollectionItem[]>(initialCollections);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [editTarget, setEditTarget] = useState<UserCollectionItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<UserCollectionItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createNameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (createModalOpen) {
      createNameInputRef.current?.focus();
    }
  }, [createModalOpen]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);

    try {
      const res = await fetch("/api/custom-collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName,
          description: createDescription.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to create collection.");
      }

      const data = await res.json();
      setCollections((prev) => [
        {
          id: data.collection.id,
          name: data.collection.name,
          description: data.collection.description,
          characterCount: 0,
          recentArtworkThumbnails: [],
          createdAt: data.collection.createdAt,
          updatedAt: data.collection.updatedAt,
        },
        ...prev,
      ]);
      setCreateModalOpen(false);
      setCreateName("");
      setCreateDescription("");
      toast.success(`Collection "${data.collection.name}" created`);
      router.refresh();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Error creating collection.");
      toast.error(sanitizeToastError(err, "Couldn't create collection. Please try again."));
    } finally {
      setCreating(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditError(null);
    setEditing(true);

    try {
      const res = await fetch(`/api/custom-collections/${encodeURIComponent(editTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to update collection.");
      }

      const data = await res.json();
      setCollections((prev) =>
        prev.map((col) =>
          col.id === editTarget.id
            ? {
                ...col,
                name: data.collection.name,
                description: data.collection.description,
                updatedAt: data.collection.updatedAt,
              }
            : col
        )
      );
      setEditTarget(null);
      toast.success("Collection renamed");
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Error updating collection.");
      toast.error(sanitizeToastError(err, "Couldn't update collection. Please try again."));
    } finally {
      setEditing(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteError(null);
    setDeleting(true);
    const targetName = deleteTarget.name;

    try {
      const res = await fetch(`/api/custom-collections/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to delete collection.");
      }

      setCollections((prev) => prev.filter((col) => col.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success(`Collection "${targetName}" deleted`);
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Error deleting collection.");
      toast.error(sanitizeToastError(err, "Couldn't delete collection. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="characters-page-shell">
      <header className="collection-page-header">
        <div className="min-w-0">
          <p className="archive-eyebrow characters-page-eyebrow">Personal Lists</p>
          <div className="collection-title-row">
            <h1 className="characters-page-title font-semibold tracking-[-0.025em] text-zinc-50">
              Collections
            </h1>
            <strong aria-live="polite">
              {collections.length} {collections.length === 1 ? "collection" : "collections"}
            </strong>
          </div>
          <p className="characters-page-subtitle max-w-2xl text-zinc-500">
            Organize characters into custom lists and categories.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setCreateError(null);
            setCreateName("");
            setCreateDescription("");
            setCreateModalOpen(true);
          }}
          className="archive-button-primary archive-focus characters-add-button shrink-0"
        >
          ＋ Create collection
        </button>
      </header>

      {collections.length === 0 ? (
        <section className="collection-empty-state" aria-label="Collections empty">
          <p className="archive-eyebrow">No collections yet</p>
          <h2>Create your first collection to group and organize characters.</h2>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="archive-button-primary archive-focus mt-3"
          >
            Create collection
          </button>
        </section>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {collections.map((col) => (
            <article
              key={col.id}
              className="archive-surface rounded-xl border border-zinc-800 p-4 flex flex-col justify-between hover:border-zinc-700 transition-colors group"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/collections/${col.id}`}
                    className="archive-focus block group-hover:text-violet-400 transition-colors"
                  >
                    <h2 className="text-base font-semibold text-zinc-100 truncate">{col.name}</h2>
                  </Link>
                  <span className="shrink-0 px-2 py-0.5 text-[11px] font-medium rounded-full bg-zinc-800 text-zinc-400">
                    {col.characterCount} {col.characterCount === 1 ? "bot" : "bots"}
                  </span>
                </div>

                {col.description && (
                  <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                    {col.description}
                  </p>
                )}

                {/* Artwork Thumbnail Collage */}
                <Link
                  href={`/collections/${col.id}`}
                  className="archive-focus mt-3 block rounded-lg overflow-hidden bg-zinc-950/80 border border-zinc-800/60 aspect-[16/7]"
                >
                  {col.recentArtworkThumbnails.length > 0 ? (
                    <div className="grid grid-cols-4 h-full w-full gap-0.5 bg-zinc-900">
                      {col.recentArtworkThumbnails.slice(0, 4).map((thumb, idx) => (
                        <div key={idx} className="relative h-full w-full overflow-hidden bg-zinc-950">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={thumb}
                            alt=""
                            className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                      ))}
                      {Array.from({ length: Math.max(0, 4 - col.recentArtworkThumbnails.length) }).map(
                        (_, idx) => (
                          <div
                            key={`empty-${idx}`}
                            className="h-full w-full bg-zinc-950/40 flex items-center justify-center text-zinc-700 text-xs"
                          >
                            ·
                          </div>
                        )
                      )}
                    </div>
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-xs text-zinc-600">
                      Empty collection
                    </div>
                  )}
                </Link>
              </div>

              <div className="mt-4 pt-3 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-500">
                <span>Updated {formatRelativeTime(col.updatedAt)}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditTarget(col);
                      setEditName(col.name);
                      setEditDescription(col.description || "");
                      setEditError(null);
                    }}
                    className="archive-focus hover:text-zinc-300 transition-colors"
                  >
                    Edit
                  </button>
                  <span>·</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteTarget(col);
                      setDeleteError(null);
                    }}
                    className="archive-focus text-red-400 hover:text-red-300 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Create Collection Modal */}
      {createModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setCreateModalOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Create Collection"
            className="archive-surface w-full max-w-md rounded-xl border border-zinc-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-zinc-100">Create new collection</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Name your collection to group and organize characters.
            </p>

            {createError && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {createError}
              </p>
            )}

            <form onSubmit={handleCreate} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Collection Name <span className="text-red-400">*</span>
                </label>
                <input
                  ref={createNameInputRef}
                  type="text"
                  required
                  maxLength={50}
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. Comfort Bots, Horror, RP Favorites"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Description <span className="text-zinc-500">(optional)</span>
                </label>
                <textarea
                  maxLength={300}
                  rows={3}
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="What is this collection for?"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => setCreateModalOpen(false)}
                  className="archive-button-secondary archive-focus text-xs px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || !createName.trim()}
                  className="archive-button-primary archive-focus text-xs px-4 py-1.5 disabled:opacity-50"
                >
                  {creating ? "Creating…" : "Create Collection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Collection Modal */}
      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setEditTarget(null)}
        >
          <div
            role="dialog"
            aria-label="Edit Collection"
            className="archive-surface w-full max-w-md rounded-xl border border-zinc-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-zinc-100">Edit collection</h3>

            {editError && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {editError}
              </p>
            )}

            <form onSubmit={handleEdit} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Collection Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={50}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1">
                  Description <span className="text-zinc-500">(optional)</span>
                </label>
                <textarea
                  maxLength={300}
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-100 placeholder-zinc-500 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={editing}
                  onClick={() => setEditTarget(null)}
                  className="archive-button-secondary archive-focus text-xs px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editing || !editName.trim()}
                  className="archive-button-primary archive-focus text-xs px-4 py-1.5 disabled:opacity-50"
                >
                  {editing ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Collection Confirmation Modal */}
      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            role="dialog"
            aria-label="Delete Collection"
            className="archive-surface max-w-sm rounded-xl border border-zinc-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-zinc-100">Delete &ldquo;{deleteTarget.name}&rdquo;?</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              This will remove the collection list. Characters inside the collection will not be deleted from the archive.
            </p>

            {deleteError && (
              <p className="mt-2 text-xs text-red-400" role="alert">
                {deleteError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
                className="archive-button-secondary archive-focus text-xs px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="archive-focus rounded-lg border border-red-500/40 bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Confirm Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(isoDate: string): string {
  try {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "";
  }
}
