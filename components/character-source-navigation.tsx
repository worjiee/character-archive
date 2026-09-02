import Link from "next/link";
import { getSourceIdentity } from "../src/lib/sources/presentation";
import {
  type CharacterSourceNavigationItem,
  type CharacterSourceNavigationKey,
} from "./character-library-utils";
import { SourceBadge } from "./character-badges";

export function CharacterSourceNavigation({
  items,
  selectedKey,
  onSelect,
}: {
  items: CharacterSourceNavigationItem[];
  selectedKey: CharacterSourceNavigationKey | null;
  onSelect: (key: CharacterSourceNavigationKey) => void;
}) {
  return (
    <nav aria-label="Browse archive" className="font-interface max-w-full overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-1.5">
        <div role="group" aria-label="Character source filters" className="flex items-center gap-1.5">{items.map((item) => {
          const selected = item.key === selectedKey;
          const isAll = item.key === "ALL";
          const identity = isAll ? null : getSourceIdentity(item.key);

          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={selected}
              aria-label={item.disabled ? `${item.label}, coming soon` : `Show ${item.label} characters`}
              title={item.disabled ? "Coming soon" : undefined}
              disabled={item.disabled}
              onClick={() => onSelect(item.key)}
              className={`archive-focus inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${selected ? "accent-muted" : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"} disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {identity && <span aria-hidden="true"><SourceBadge platform={identity.key} variant="compact" /></span>}
              <span aria-hidden={item.disabled ? "true" : undefined}>{item.label}</span>
              {item.count !== null && <span aria-hidden="true" className="rounded-full bg-black/15 px-1.5 py-0.5 text-[10px] tabular-nums opacity-75">{item.count}</span>}
              {item.disabled && <span className="sr-only">Coming soon</span>}
            </button>
          );
        })}</div>
        <span aria-hidden="true" className="mx-1 h-6 border-l border-zinc-700" />
        <Link href="/lorebooks" className="archive-focus inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-1.5 text-xs font-semibold text-zinc-400 transition hover:border-[var(--accent-border)] hover:bg-zinc-900 hover:text-zinc-100">
          <span aria-hidden="true">▤</span>
          Lorebooks
        </Link>
      </div>
    </nav>
  );
}
