"use client";

import { useEffect, useState } from "react";
import type { CharacterQuickViewData } from "@/src/lib/characters/browse";
import { CharacterQuickView, type QuickViewNavigationItem } from "./character-quick-view";

const persistentQuickViewCache = new Map<string, CharacterQuickViewData>();

export function clearQuickViewCache(characterId?: string): void {
  if (characterId) persistentQuickViewCache.delete(characterId);
  else persistentQuickViewCache.clear();
}

export function CharacterQuickViewHost({
  characterId,
  navigationItems = [],
  onNavigate,
  onClose,
}: {
  characterId: string;
  navigationItems?: QuickViewNavigationItem[];
  onNavigate?: (characterId: string) => void;
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(characterId);
  const [quickView, setQuickView] = useState<{
    data: CharacterQuickViewData | null;
    loading: boolean;
    error: string | null;
  }>(() => {
    const cached = persistentQuickViewCache.get(characterId);
    return { data: cached ?? null, loading: !cached, error: null };
  });

  if (activeId !== characterId) {
    setActiveId(characterId);
    const cached = persistentQuickViewCache.get(characterId);
    setQuickView({ data: cached ?? null, loading: !cached, error: null });
  }

  const { previousCharacter, nextCharacter } = quickViewNeighbors(navigationItems, characterId);

  useEffect(() => {
    if (persistentQuickViewCache.has(characterId)) {
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/characters/${encodeURIComponent(characterId)}`, {
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
      persistentQuickViewCache.set(characterId, body.character);
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
  }, [characterId]);

  return (
    <CharacterQuickView
      characterId={characterId}
      character={quickView.data}
      loading={quickView.loading}
      error={quickView.error}
      previousCharacter={previousCharacter}
      nextCharacter={nextCharacter}
      onPrevious={previousCharacter && onNavigate ? () => onNavigate(previousCharacter.id) : undefined}
      onNext={nextCharacter && onNavigate ? () => onNavigate(nextCharacter.id) : undefined}
      onClose={onClose}
    />
  );
}

export function quickViewNeighbors(navigationItems: readonly QuickViewNavigationItem[], characterId: string): {
  previousCharacter?: QuickViewNavigationItem;
  nextCharacter?: QuickViewNavigationItem;
} {
  const index = navigationItems.findIndex((item) => item.id === characterId);
  return {
    previousCharacter: index > 0 ? navigationItems[index - 1] : undefined,
    nextCharacter: index >= 0 && index < navigationItems.length - 1 ? navigationItems[index + 1] : undefined,
  };
}
