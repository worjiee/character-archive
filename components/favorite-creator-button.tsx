"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AuthorIdentity } from "../src/lib/authors/identity";

type Provenance = Array<"MANUAL" | "DATACAT">;

export function FavoriteCreatorButton({
  identity,
  creatorName,
  initialPresent,
  initialProvenance,
  variant = "icon",
  onEffectiveChange,
}: {
  identity: AuthorIdentity;
  creatorName: string;
  initialPresent: boolean;
  initialProvenance: Provenance;
  variant?: "icon" | "text";
  onEffectiveChange?: (present: boolean) => void;
}) {
  const router = useRouter();
  const [present, setPresent] = useState(initialPresent);
  const [provenance, setProvenance] = useState<Provenance>(initialProvenance);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const manual = provenance.includes("MANUAL");
  const datacatOnly = present && provenance.includes("DATACAT") && !manual;
  const action = manual || (present && provenance.length === 0) ? "Remove" : "Add";
  const accessibleLabel = datacatOnly
    ? `${creatorName} is a Favorite Creator synced from DataCat`
    : `${action} ${creatorName} ${action === "Add" ? "to" : "from"} Favorite Creators`;

  async function toggle() {
    if (datacatOnly || isPending) return;
    const requestedPresent = !manual && !present;
    const previous = { present, provenance };
    setError("");
    setPresent(requestedPresent || provenance.includes("DATACAT"));
    setProvenance(requestedPresent
      ? [...new Set([...provenance, "MANUAL" as const])]
      : provenance.filter((source) => source !== "MANUAL"));
    try {
      const response = await fetch("/api/favorite-creators", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: identity.platform,
          identityKind: identity.kind,
          identityValue: identity.value,
          present: requestedPresent,
        }),
      });
      const payload = await response.json() as { present?: boolean; provenance?: Provenance; error?: string };
      if (!response.ok || typeof payload.present !== "boolean" || !Array.isArray(payload.provenance)) {
        throw new Error(payload.error ?? "Unable to update Favorite Creators.");
      }
      setPresent(payload.present);
      setProvenance(payload.provenance);
      onEffectiveChange?.(payload.present);
      startTransition(() => router.refresh());
    } catch (cause) {
      setPresent(previous.present);
      setProvenance(previous.provenance);
      setError(cause instanceof Error ? cause.message : "Unable to update Favorite Creators.");
    }
  }

  if (variant === "text") {
    return (
      <div className="min-w-0">
        <button
          type="button"
          onClick={toggle}
          disabled={datacatOnly || isPending}
          aria-pressed={present}
          aria-label={accessibleLabel}
          className="favorite-creator-text-button archive-button-secondary archive-focus w-full justify-center whitespace-nowrap disabled:cursor-default disabled:opacity-80 sm:w-auto"
          data-selected={present ? "true" : undefined}
        >
          <HeartIcon filled={present} />
          <span>{datacatOnly ? "Synced from DataCat" : present ? "Remove from Favorite Creators" : "Add to Favorite Creators"}</span>
        </button>
        <p className="mt-1.5 text-xs leading-5 text-zinc-500">
          {datacatOnly ? "This Favorite Creator is managed by DataCat." : "Get notified when this creator adds a new character."}
        </p>
        {error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}
      </div>
    );
  }

  return (
    <div className="relative z-10 shrink-0">
      <button
        type="button"
        onClick={toggle}
        disabled={datacatOnly || isPending}
        aria-pressed={present}
        aria-label={accessibleLabel}
        title={datacatOnly ? "Favorite Creator · Synced from DataCat" : `${action} Favorite Creator`}
        className="archive-focus grid size-11 place-items-center rounded-lg border border-zinc-700 bg-zinc-950/85 text-zinc-400 transition hover:border-amber-500/50 hover:text-amber-300 disabled:cursor-default"
      >
        <HeartIcon filled={present} />
      </button>
      {error && <span role="alert" className="sr-only">{error}</span>}
    </div>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4.5 w-4.5 ${filled ? "fill-amber-400 text-amber-400" : "fill-none"}`} stroke="currentColor" strokeWidth="1.8">
      <path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.4 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
    </svg>
  );
}
