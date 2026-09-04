"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CharacterCollectionActions } from "./character-collection-actions";
import { clearQuickViewCache } from "./character-quick-view-host";
import type { UserRole } from "@/src/lib/auth";

export function CharacterRecordActions({
  characterId,
  characterName,
  role,
  status,
}: {
  characterId: string;
  characterName: string;
  role: UserRole;
  status: string;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      const response = await fetch(`/api/characters/${encodeURIComponent(characterId)}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: { message?: string } }).error?.message ?? "Failed to delete character.");
      }
      clearQuickViewCache(characterId);
      router.push("/characters");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete character.");
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="character-record-actions flex flex-wrap items-center gap-3">
      <CharacterCollectionActions
        characterId={characterId}
        characterName={characterName}
        variant="record"
      />
      {role === "ADMIN" && status !== "DELETED" && (
        <button
          type="button"
          disabled={deleting}
          onClick={() => setConfirmOpen(true)}
          className="archive-focus inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        >
          <span aria-hidden="true">🗑</span>
          <span>{deleting ? "Deleting…" : "Soft-delete character"}</span>
        </button>
      )}

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="archive-surface max-w-sm rounded-xl border border-zinc-800 p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-zinc-100">Soft-delete {characterName}?</h3>
            <p className="mt-2 text-xs leading-5 text-zinc-400">
              This character will be moved to Deleted status. It can be reviewed or restored by an Admin from Settings at any time.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmOpen(false)}
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
    </div>
  );
}
