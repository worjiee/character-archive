import Link from "next/link";
import { getSourceIdentity, SOURCE_NAVIGATION_PLATFORM_KEYS } from "../src/lib/sources/presentation";
import { SourceBadge } from "./character-badges";

export function LorebookBrowseNavigation() {
  return (
    <nav aria-label="Browse archive" className="max-w-full overflow-x-auto pb-1">
      <div className="flex min-w-max items-center gap-1.5">
        <div role="group" aria-label="Character source filters" className="flex items-center gap-1.5">
          <Link href="/characters" className="archive-focus inline-flex min-h-9 items-center rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100">All</Link>
          {SOURCE_NAVIGATION_PLATFORM_KEYS.map((platform) => {
            const identity = getSourceIdentity(platform);
            return platform === "JANNY" ? (
              <span key={platform} aria-label={`${identity.label}, coming soon`} title="Coming soon" className="inline-flex min-h-9 cursor-not-allowed items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 opacity-45">
                <SourceBadge platform={platform} variant="compact" />
                {identity.label}
              </span>
            ) : (
              <Link key={platform} href={`/characters?source=${platform}`} className="archive-focus inline-flex min-h-9 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 px-2.5 py-1.5 text-xs font-semibold text-zinc-400 hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100">
                <SourceBadge platform={platform} variant="compact" />
                <span className="sr-only">Browse </span>{identity.label}<span className="sr-only"> characters</span>
              </Link>
            );
          })}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 border-l border-zinc-700" />
        <Link href="/lorebooks" aria-current="page" className="archive-focus accent-muted inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold">
          <span aria-hidden="true">▤</span>
          Lorebooks
        </Link>
      </div>
    </nav>
  );
}
