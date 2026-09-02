"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CartAuthorGroup } from "@/src/lib/characters/cart-groups";
import {
  CHARACTER_CART_CHECKOUT_FILENAME,
  CHARACTER_CART_CHECKOUT_MAX_CHARACTERS,
} from "../src/lib/characters/cart-checkout-constants";
import { CharacterCardGrid } from "./character-card-grid";
import { useCharacterCollections } from "./character-collections-provider";

interface SelectionState {
  checked: boolean;
  indeterminate: boolean;
}

export function CartAuthorGroupedCollection({
  groups,
  limited = false,
}: {
  groups: CartAuthorGroup[];
  limited?: boolean;
}) {
  const collections = useCharacterCollections();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState(() => new Set(groups.map(({ key }) => key)));
  const [checkoutState, setCheckoutState] = useState<"idle" | "pending">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const visibleGroups = useMemo(() => groups.flatMap((group) => {
    const characters = group.characters.filter(({ id }) => collections.cartIds.has(id));
    return characters.length > 0 ? [{ ...group, characters, characterIds: characters.map(({ id }) => id) }] : [];
  }), [collections.cartIds, groups]);
  const visibleIds = useMemo(
    () => visibleGroups.flatMap(({ characterIds }) => characterIds),
    [visibleGroups],
  );
  const activeSelectedIds = selectedIds.filter((id) => collections.cartIds.has(id));
  const selectedSet = new Set(activeSelectedIds);
  const selectedAuthorCount = visibleGroups.filter((group) => group.characterIds.some((id) => selectedSet.has(id))).length;
  const globalState = getSelectionState(visibleIds, activeSelectedIds);
  const tooManySelected = activeSelectedIds.length > CHARACTER_CART_CHECKOUT_MAX_CHARACTERS;

  if (collections.cartIds.size === 0) return <CartEmptyState />;

  function updateCharacterSelection(characterId: string, selected: boolean) {
    setSelectedIds((current) => updateCartSelection(current, [characterId], selected));
    setCheckoutError(null);
  }

  function updateGroupSelection(characterIds: readonly string[], selected: boolean) {
    setSelectedIds((current) => updateCartSelection(current, characterIds, selected));
    setCheckoutError(null);
  }

  function toggleGroup(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function checkoutSelected() {
    if (activeSelectedIds.length === 0 || tooManySelected || checkoutState === "pending") return;
    setCheckoutState("pending");
    setCheckoutError(null);
    try {
      const response = await fetch("/api/collections/cart/checkout/zip", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ characterIds: activeSelectedIds }),
      });
      if (!response.ok) throw new Error(await readCheckoutError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = CHARACTER_CART_CHECKOUT_FILENAME;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (error) {
      setCheckoutError(error instanceof Error ? error.message : "The ZIP checkout could not be prepared.");
    } finally {
      setCheckoutState("idle");
    }
  }

  return (
    <>
      <header className="collection-page-header cart-page-header">
        <div className="min-w-0">
          <p className="archive-eyebrow characters-page-eyebrow">Export basket</p>
          <div className="collection-title-row">
            <h1 className="characters-page-title font-semibold tracking-[-0.025em] text-zinc-50">Cart</h1>
            <strong aria-live="polite">
              {visibleGroups.length} {visibleGroups.length === 1 ? "author" : "authors"}{limited ? " shown" : ""} · {visibleIds.length} {visibleIds.length === 1 ? "bot" : "bots"}{limited ? " shown" : ""}
            </strong>
          </div>
          <p className="characters-page-subtitle max-w-2xl text-zinc-500">
            Review your export basket and choose the characters to package by author.
          </p>
        </div>
        <Link href="/characters" className="archive-button-secondary archive-focus characters-add-button shrink-0">Add characters</Link>
      </header>

      <section className="cart-checkout-toolbar" aria-label="Cart checkout selection">
        <div className="cart-global-selection">
          <IndeterminateCheckbox
            label={globalState.checked ? "Deselect all characters in Cart" : "Select all characters in Cart"}
            state={globalState}
            onChange={(selected) => updateGroupSelection(visibleIds, selected)}
          />
          <div>
            <strong aria-live="polite">{activeSelectedIds.length} selected</strong>
            <span>{selectedAuthorCount} {selectedAuthorCount === 1 ? "author" : "authors"}</span>
          </div>
        </div>
        <button
          type="button"
          disabled={activeSelectedIds.length === 0 || tooManySelected || checkoutState === "pending"}
          aria-label={`Download ZIP for ${activeSelectedIds.length} selected ${activeSelectedIds.length === 1 ? "character" : "characters"}`}
          onClick={() => void checkoutSelected()}
          className="archive-button-primary archive-focus cart-download-action"
        >
          {checkoutState === "pending" ? "Preparing ZIP…" : "Download ZIP"}
        </button>
        <p className={tooManySelected ? "cart-checkout-message cart-checkout-error" : "cart-checkout-message"}>
          {tooManySelected
            ? `Choose no more than ${CHARACTER_CART_CHECKOUT_MAX_CHARACTERS} characters for one checkout.`
            : `ZIP checkout supports up to ${CHARACTER_CART_CHECKOUT_MAX_CHARACTERS} selected characters. Your Cart stays unchanged.`}
        </p>
        {checkoutError && <p className="cart-checkout-error" role="alert">{checkoutError}</p>}
      </section>

      {limited && (
        <p className="collection-result-note">
          Showing the first 100 Cart characters. Remove items to reach characters outside this bounded view.
        </p>
      )}

      <section className="cart-author-groups" aria-label="Cart characters grouped by author">
        {visibleGroups.map((group, index) => {
          const groupSelection = getSelectionState(group.characterIds, activeSelectedIds);
          const groupSelectedCount = group.characterIds.filter((id) => selectedSet.has(id)).length;
          const expanded = expandedKeys.has(group.key);
          const regionId = `cart-author-group-${index}`;
          return (
            <section key={group.key} className="cart-author-group" aria-labelledby={`${regionId}-heading`}>
              <div className="cart-author-group-header">
                <IndeterminateCheckbox
                  label={`${groupSelection.checked ? "Deselect all" : group.characterIds.length === 1 ? "Select" : "Select all"} ${group.characterIds.length} ${group.characterIds.length === 1 ? "character" : "characters"} by ${group.name}`}
                  state={groupSelection}
                  onChange={(selected) => updateGroupSelection(group.characterIds, selected)}
                />
                <button
                  type="button"
                  className="cart-author-toggle archive-focus"
                  aria-expanded={expanded}
                  aria-controls={regionId}
                  onClick={() => toggleGroup(group.key)}
                >
                  <span aria-hidden="true" className="cart-author-caret">{expanded ? "▾" : "▸"}</span>
                  <span className="cart-author-heading-copy">
                    <strong id={`${regionId}-heading`}>{group.name}</strong>
                    <span>{groupSelectedCount} / {group.characterIds.length} selected</span>
                  </span>
                </button>
                {group.platformLabel && <span className="cart-author-source">{group.platformLabel}</span>}
              </div>
              {expanded && (
                <div id={regionId} className="cart-author-group-body">
                  <CharacterCardGrid
                    characters={group.characters}
                    className="cart-author-character-grid"
                    selection={{ selectedIds: activeSelectedIds, onChange: updateCharacterSelection }}
                  />
                </div>
              )}
            </section>
          );
        })}
      </section>
    </>
  );
}

export function getSelectionState(
  availableIds: readonly string[],
  selectedIds: readonly string[],
): SelectionState {
  const selected = new Set(selectedIds);
  const count = availableIds.reduce((total, id) => total + Number(selected.has(id)), 0);
  return {
    checked: availableIds.length > 0 && count === availableIds.length,
    indeterminate: count > 0 && count < availableIds.length,
  };
}

export function updateCartSelection(
  selectedIds: readonly string[],
  targetIds: readonly string[],
  selected: boolean,
): string[] {
  const next = new Set(selectedIds);
  for (const id of targetIds) {
    if (selected) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

function IndeterminateCheckbox({
  label,
  state,
  onChange,
}: {
  label: string;
  state: SelectionState;
  onChange: (selected: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state.indeterminate;
  }, [state.indeterminate]);
  return (
    <label className="cart-selection-checkbox archive-focus">
      <input
        ref={ref}
        type="checkbox"
        checked={state.checked}
        aria-checked={state.indeterminate ? "mixed" : state.checked}
        aria-label={label}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span aria-hidden="true">{state.indeterminate ? "−" : "✓"}</span>
    </label>
  );
}

function CartEmptyState() {
  return (
    <section className="collection-empty-state" aria-label="Cart empty">
      <p className="archive-eyebrow">Your Cart is empty</p>
      <h2>Add characters to prepare them for export.</h2>
      <Link href="/characters" className="archive-button-secondary archive-focus">Browse Characters</Link>
    </section>
  );
}

async function readCheckoutError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: { message?: unknown } };
    if (typeof payload.error?.message === "string") return payload.error.message;
  } catch {
    // A non-JSON server failure receives the same safe client message.
  }
  return "The ZIP checkout could not be prepared.";
}
