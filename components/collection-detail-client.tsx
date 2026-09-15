"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CharacterCardGrid } from "./character-card-grid";
import type { UserCollectionDetail } from "@/src/lib/collections/custom-collections";
import type { CharacterCardItem } from "@/src/lib/characters/browse";
import { useToast } from "./toast-provider";
import { sanitizeToastError } from "./toast-utils";

interface CollectionDetailClientProps {
  collection: UserCollectionDetail;
  characters: CharacterCardItem[];
  total: number;
  page: number;
  totalPages: number;
  query?: string;
  sort?: "added" | "freshest" | "name";
}

export function CollectionDetailClient({
  collection: initialCollection,
  characters,
  total,
  page,
  totalPages,
  query = "",
  sort = "added",
}: CollectionDetailClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [collection, setCollection] = useState<UserCollectionDetail>(initialCollection);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(collection.name);
  const [editDescription, setEditDescription] = useState(collection.description || "");
  const [editError, setEditError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditError(null);
    setEditing(true);

    try {
      const res = await fetch(`/api/custom-collections/${encodeURIComponent(collection.id)}`, {
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
      setCollection((prev) => ({
        ...prev,
        name: data.collection.name,
        description: data.collection.description,
        updatedAt: data.collection.updatedAt,
      }));
      setEditOpen(false);
      toast.success("Collection updated");
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Error updating collection.");
      toast.error(sanitizeToastError(err, "Couldn't update collection. Please try again."));
    } finally {
      setEditing(false);
    }
  }

  async function handleDelete() {
    setDeleteError(null);
    setDeleting(true);
    const targetName = collection.name;

    try {
      const res = await fetch(`/api/custom-collections/${encodeURIComponent(collection.id)}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Failed to delete collection.");
      }

      toast.success(`Collection "${targetName}" deleted`);
      router.push("/collections");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Error deleting collection.");
      toast.error(sanitizeToastError(err, "Couldn't delete collection. Please try again."));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="characters-page-shell">
      {/* Header */}
      <header className="collection-page-header">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-2">
            <Link
              href="/collections"
              className="text-xs text-violet-400 hover:text-violet-300 font-medium inline-flex items-center gap-1 archive-focus"
            >
              <span>←</span>
              <span>All Collections</span>
            </Link>
          </nav>
          <div className="collection-title-row">
            <h1 className="characters-page-title font-semibold tracking-[-0.025em] text-zinc-50 truncate">
              {collection.name}
            </h1>
            <strong aria-live="polite">
              {total} {total === 1 ? "character" : "characters"}
            </strong>
          </div>
          {collection.description && (
            <p className="characters-page-subtitle max-w-2xl text-zinc-400 mt-1">
              {collection.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditName(collection.name);
              setEditDescription(collection.description || "");
              setEditError(null);
              setEditOpen(true);
            }}
            className="archive-button-secondary archive-focus text-xs px-3 py-1.5"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              setDeleteError(null);
              setDeleteOpen(true);
            }}
            className="archive-focus rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20"
          >
            Delete
          </button>
        </div>
      </header>

      {/* Search & Sort Toolbar */}
      <form
        action={`/collections/${collection.id}`}
        method="get"
        role="search"
        aria-label={`Search ${collection.name}`}
        className="collection-browse-toolbar mt-4"
      >
        <label className="collection-search-field">
          <span className="sr-only">Search collection</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7" />
            <path d="m16.5 16.5 4 4" />
          </svg>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="Search characters in collection..."
            maxLength={80}
            className="archive-focus"
          />
        </label>
        <label className="collection-sort-field">
          <span className="sr-only">Sort collection</span>
          <select name="sort" defaultValue={sort} className="archive-focus">
            <option value="added">Recently added</option>
            <option value="freshest">Freshest published</option>
            <option value="name">Name A–Z</option>
          </select>
        </label>
        <button type="submit" className="archive-button-secondary archive-focus">
          Apply
        </button>
        {(query || sort !== "added") && (
          <Link
            href={`/collections/${collection.id}`}
            className="collection-clear-link archive-focus"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Results */}
      {characters.length === 0 ? (
        query ? (
          <section className="collection-empty-state" aria-label="No matching characters">
            <p className="archive-eyebrow">No matches</p>
            <h2>No characters in this collection match &ldquo;{query}&rdquo;.</h2>
            <p>Try searching for a different name or author.</p>
            <Link
              href={`/collections/${collection.id}`}
              className="archive-button-secondary archive-focus mt-3"
            >
              Clear search
            </Link>
          </section>
        ) : (
          <section className="collection-empty-state" aria-label="Collection empty">
            <p className="archive-eyebrow">Collection empty</p>
            <h2>This collection doesn&apos;t have any characters yet.</h2>
            <p>Browse characters and click the collection icon on any card to add them here.</p>
            <Link href="/characters" className="archive-button-primary archive-focus mt-3">
              Browse Characters
            </Link>
          </section>
        )
      ) : (
        <section className="collection-results mt-6" aria-label="Characters in collection">
          {query && (
            <p className="collection-result-note mb-3">
              {total} matching {total === 1 ? "character" : "characters"}
            </p>
          )}
          <CharacterCardGrid
            characters={characters}
            className="dense-character-grid collection-character-grid"
          />

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-8 py-4 border-t border-zinc-800">
              {page > 1 && (
                <Link
                  href={`/collections/${collection.id}?q=${encodeURIComponent(query)}&sort=${sort}&page=${page - 1}`}
                  className="archive-button-secondary archive-focus text-xs px-3 py-1.5"
                >
                  Previous
                </Link>
              )}
              <span className="text-xs text-zinc-400">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link
                  href={`/collections/${collection.id}?q=${encodeURIComponent(query)}&sort=${sort}&page=${page + 1}`}
                  className="archive-button-secondary archive-focus text-xs px-3 py-1.5"
                >
                  Next
                </Link>
              )}
            </div>
          )}
        </section>
      )}

      {/* Edit Collection Modal */}
      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setEditOpen(false)}
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
                  onClick={() => setEditOpen(false)}
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

      {/* Delete Collection Modal */}
      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setDeleteOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Delete Collection"
            className="archive-surface max-w-sm rounded-xl border border-zinc-800 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-zinc-100">Delete &ldquo;{collection.name}&rdquo;?</h3>
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
                onClick={() => setDeleteOpen(false)}
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
