import Link from "next/link";
import type { CharacterBrowseFacets } from "../src/lib/characters/browse";
import {
  getSourceIdentity,
  type PersistedSourcePlatform,
} from "../src/lib/sources/presentation";
import { SourceBadge } from "./character-badges";

const HOME_SOURCE_KEYS = ["JANITOR_AI", "SAUCEPAN", "DATACAT"] as const;

export function HomeSourceOverview({
  total,
  sources,
}: {
  total: number;
  sources: CharacterBrowseFacets["sources"];
}) {
  const counts = new Map(sources.map((source) => [source.value, source.count]));

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <SourceOverviewLink label="All sources" count={total} href="/characters" mark="All" />
      {HOME_SOURCE_KEYS.map((platform) => {
        const identity = getSourceIdentity(platform);
        return (
          <SourceOverviewLink
            key={platform}
            label={identity.label}
            count={counts.get(platform) ?? 0}
            href={sourceHref(platform)}
            platform={platform}
          />
        );
      })}
      <div
        aria-disabled="true"
        title="Janny source support is coming soon"
        className="archive-panel flex min-h-20 cursor-not-allowed items-center gap-3 px-3.5 py-3 opacity-55"
      >
        <SourceBadge platform="JANNY" variant="compact" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-zinc-300">{getSourceIdentity("JANNY").label}</p>
          <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">Coming soon</p>
        </div>
      </div>
    </div>
  );
}

function SourceOverviewLink({
  label,
  count,
  href,
  platform,
  mark,
}: {
  label: string;
  count: number;
  href: string;
  platform?: PersistedSourcePlatform;
  mark?: string;
}) {
  return (
    <Link
      href={href}
      className="archive-panel archive-focus group flex min-h-20 items-center gap-3 px-3.5 py-3 transition hover:border-[var(--accent-border)] hover:bg-zinc-900/55"
    >
      {platform
        ? <SourceBadge platform={platform} variant="compact" />
        : <span aria-hidden="true" className="accent-muted inline-flex h-6 min-w-8 items-center justify-center rounded-full border px-2 text-[10px] font-bold">{mark}</span>}
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-zinc-300 transition group-hover:text-zinc-100">{label}</p>
        <p className="mt-1 text-[10px] tabular-nums text-zinc-600">{count} {count === 1 ? "character" : "characters"}</p>
      </div>
    </Link>
  );
}

function sourceHref(platform: PersistedSourcePlatform): string {
  return `/characters?source=${encodeURIComponent(platform)}`;
}
