"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CharacterCardItem,
  CharacterQuickViewData,
} from "@/src/lib/characters/browse";
import { CharacterLibraryCard } from "./character-library-card";
import { CharacterQuickView } from "./character-quick-view";

export function CharacterCardGrid({
  characters,
  className = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3 sm:gap-3.5",
}: {
  characters: CharacterCardItem[];
  className?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [quickView, setQuickView] = useState<{
    data: CharacterQuickViewData | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void fetch(`/api/characters/${encodeURIComponent(selectedId)}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(response.status === 404
          ? "This character is no longer available."
          : "The preview could not be loaded.");
      }
      const body = await response.json() as { character?: CharacterQuickViewData };
      if (!body.character) throw new Error("The preview response was incomplete.");
      setQuickView({ data: body.character, loading: false, error: null });
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setQuickView({
        data: null,
        loading: false,
        error: error instanceof Error ? error.message : "The preview could not be loaded.",
      });
    });
    return () => controller.abort();
  }, [selectedId]);

  function openQuickView(characterId: string, trigger: HTMLButtonElement) {
    openerRef.current = trigger;
    setQuickView({ data: null, loading: true, error: null });
    setSelectedId(characterId);
  }

  function closeQuickView() {
    setSelectedId(null);
    setQuickView({ data: null, loading: false, error: null });
    window.setTimeout(() => openerRef.current?.focus(), 0);
  }

  return (
    <>
      <div className={className}>
        {characters.map((character) => (
          <CharacterLibraryCard
            key={character.id}
            character={character}
            onOpen={(trigger) => openQuickView(character.id, trigger)}
          />
        ))}
      </div>
      {selectedId && (
        <CharacterQuickView
          characterId={selectedId}
          character={quickView.data}
          loading={quickView.loading}
          error={quickView.error}
          onClose={closeQuickView}
        />
      )}
    </>
  );
}
