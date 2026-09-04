"use client";

import { createContext, useContext, useMemo, useRef, useState } from "react";
import type { CharacterCollectionKind, CharacterCollectionState } from "../src/lib/characters/collections";
import type { UserRole } from "@/src/lib/auth";

interface CharacterCollectionsContextValue {
  role: UserRole;
  favoriteIds: ReadonlySet<string>;
  cartIds: ReadonlySet<string>;
  favoriteCount: number;
  cartCount: number;
  isPending: (collection: CharacterCollectionKind, characterId: string) => boolean;
  setFavorite: (characterId: string, characterName: string, present: boolean) => Promise<boolean>;
  setCart: (characterId: string, characterName: string, present: boolean) => Promise<boolean>;
  addManyToCart: (characterIds: readonly string[]) => Promise<{ success: boolean; added: number; count: number }>;
}

interface CharacterCollectionsClientState extends CharacterCollectionState {
  pendingKeys: string[];
  announcement: string | null;
}

const CharacterCollectionsContext = createContext<CharacterCollectionsContextValue | null>(null);

export function CharacterCollectionsProvider({
  initialState,
  role = "MEMBER",
  children,
}: {
  initialState: CharacterCollectionState;
  role?: UserRole;
  children?: React.ReactNode;
}) {
  const [state, setState] = useState<CharacterCollectionsClientState>(() => ({
    favoriteIds: uniqueIds(initialState.favoriteIds),
    cartIds: uniqueIds(initialState.cartIds),
    pendingKeys: [],
    announcement: null,
  }));
  const pendingRef = useRef(new Set<string>());
  const favoriteIds = useMemo(() => new Set(state.favoriteIds), [state.favoriteIds]);
  const cartIds = useMemo(() => new Set(state.cartIds), [state.cartIds]);

  async function setMembership(
    collection: CharacterCollectionKind,
    characterId: string,
    characterName: string,
    present: boolean,
  ): Promise<boolean> {
    const key = pendingKey(collection, characterId);
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    const previousPresent = collectionIds(state, collection).includes(characterId);
    setState((current) => ({
      ...withMembership(current, collection, characterId, present),
      pendingKeys: [...current.pendingKeys, key],
      announcement: null,
    }));

    try {
      const response = await fetch(
        `/api/collections/${collection}/${encodeURIComponent(characterId)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ present }),
        },
      );
      if (!response.ok) throw new Error("Collection update failed.");
      setState((current) => ({
        ...current,
        pendingKeys: current.pendingKeys.filter((item) => item !== key),
        announcement: membershipAnnouncement(collection, characterName, present),
      }));
      return true;
    } catch {
      setState((current) => ({
        ...withMembership(current, collection, characterId, previousPresent),
        pendingKeys: current.pendingKeys.filter((item) => item !== key),
        announcement: `Could not update ${collection === "favorites" ? "Favorites" : "Cart"}. Please try again.`,
      }));
      return false;
    } finally {
      pendingRef.current.delete(key);
    }
  }

  async function addManyToCart(characterIds: readonly string[]): Promise<{ success: boolean; added: number; count: number }> {
    const ids = uniqueIds(characterIds);
    const available = ids.filter((id) => !pendingRef.current.has(pendingKey("cart", id)));
    if (available.length === 0) return { success: true, added: 0, count: state.cartIds.length };
    const previousCartIds = state.cartIds;
    const previouslyPresent = new Set(previousCartIds);
    const keys = available.map((id) => pendingKey("cart", id));
    keys.forEach((key) => pendingRef.current.add(key));
    setState((current) => ({
      ...current,
      cartIds: uniqueIds([...current.cartIds, ...available]),
      pendingKeys: uniqueIds([...current.pendingKeys, ...keys]),
      announcement: null,
    }));

    try {
      const response = await fetch("/api/collections/cart", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ characterIds: available }),
      });
      if (!response.ok) throw new Error("Cart update failed.");
      const result = await response.json() as { added?: unknown; count?: unknown };
      const added = typeof result.added === "number" ? result.added : 0;
      const count = typeof result.count === "number" ? result.count : uniqueIds([...state.cartIds, ...available]).length;
      setState((current) => ({
        ...current,
        pendingKeys: current.pendingKeys.filter((key) => !keys.includes(key)),
        announcement: added > 0 ? `${added} ${added === 1 ? "character" : "characters"} added to Cart. Cart ${count}.` : `All selected characters are already in Cart. Cart ${count}.`,
      }));
      return { success: true, added, count };
    } catch {
      setState((current) => ({
        ...current,
        cartIds: current.cartIds.filter((id) => !available.includes(id) || previouslyPresent.has(id)),
        pendingKeys: current.pendingKeys.filter((key) => !keys.includes(key)),
        announcement: "Could not add the selected characters to Cart. Please try again.",
      }));
      return { success: false, added: 0, count: previousCartIds.length };
    } finally {
      keys.forEach((key) => pendingRef.current.delete(key));
    }
  }

  const value: CharacterCollectionsContextValue = {
    role,
    favoriteIds,
    cartIds,
    favoriteCount: favoriteIds.size,
    cartCount: cartIds.size,
    isPending: (collection, characterId) => state.pendingKeys.includes(pendingKey(collection, characterId)),
    setFavorite: (characterId, characterName, present) => setMembership("favorites", characterId, characterName, present),
    setCart: (characterId, characterName, present) => setMembership("cart", characterId, characterName, present),
    addManyToCart,
  };

  return (
    <CharacterCollectionsContext.Provider value={value}>
      {children}
      <span className="sr-only" role="status" aria-live="polite">{state.announcement}</span>
    </CharacterCollectionsContext.Provider>
  );
}

export function useCharacterCollections(): CharacterCollectionsContextValue {
  const context = useContext(CharacterCollectionsContext);
  if (!context) throw new Error("useCharacterCollections must be used within CharacterCollectionsProvider.");
  return context;
}

export function withMembership(
  state: CharacterCollectionState,
  collection: CharacterCollectionKind,
  characterId: string,
  present: boolean,
): CharacterCollectionState {
  const ids = collectionIds(state, collection);
  const nextIds = present ? uniqueIds([...ids, characterId]) : ids.filter((id) => id !== characterId);
  return collection === "favorites"
    ? { favoriteIds: nextIds, cartIds: state.cartIds }
    : { favoriteIds: state.favoriteIds, cartIds: nextIds };
}

function collectionIds(state: CharacterCollectionState, collection: CharacterCollectionKind): string[] {
  return collection === "favorites" ? state.favoriteIds : state.cartIds;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function pendingKey(collection: CharacterCollectionKind, characterId: string): string {
  return `${collection}:${characterId}`;
}

function membershipAnnouncement(collection: CharacterCollectionKind, characterName: string, present: boolean): string {
  if (collection === "favorites") return `${characterName} ${present ? "added to" : "removed from"} Favorites.`;
  return `${characterName} ${present ? "added to" : "removed from"} Cart.`;
}
