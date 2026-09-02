import Link from "next/link";
import type { FreshPageData } from "@/src/lib/home/fresh";
import { relativeActivityLabel } from "../src/lib/home/relative-activity";
import { SourceBadge } from "./character-badges";
import { FreshCharacterFeed } from "./fresh-character-feed";
import { FreshToolbar } from "./fresh-toolbar";

export function FreshHome({ data }: { data: FreshPageData }) {
  return (
    <div className="fresh-page-shell">
      <FreshHero />
      <div className="fresh-section-strip"><span aria-hidden="true">▤</span><span>Feed</span></div>
      <div className="fresh-layout">
        <section className="min-w-0" aria-label="Fresh characters">
          <FreshToolbar window={data.window} sort={data.sort} />
          {data.items.length > 0 ? (
            <FreshCharacterFeed characters={data.items} now={data.generatedAt} />
          ) : (
            <FreshEmptyState window={data.window} sort={data.sort} />
          )}
        </section>
        <RecentActivityRail activity={data.activity} now={data.generatedAt} />
      </div>
    </div>
  );
}

export function FreshHomeSkeleton() {
  return (
    <div className="fresh-page-shell" aria-label="Loading Fresh characters" aria-busy="true">
      <div className="fresh-hero animate-pulse" />
      <div className="fresh-section-strip"><span>Feed</span></div>
      <div className="fresh-layout">
        <div><div className="fresh-toolbar h-12 animate-pulse" />{Array.from({ length: 4 }, (_, index) => <FreshRowSkeleton key={index} />)}</div>
        <aside className="fresh-activity-rail min-h-72 animate-pulse" />
      </div>
    </div>
  );
}

function FreshHero() {
  return (
    <section className="fresh-hero" aria-labelledby="fresh-heading">
      <div className="fresh-hero-mark" aria-hidden="true">CA</div>
      <div className="relative z-10 min-w-0">
        <p className="archive-eyebrow">Character Archive</p>
        <h1 id="fresh-heading" className="mt-1 text-2xl font-bold uppercase tracking-[-0.025em] text-zinc-50 sm:text-[1.9rem]">Fresh</h1>
        <p className="mt-1 max-w-xl text-sm text-zinc-300">Recent characters and archive activity across supported sources.</p>
        <p className="font-interface mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.08em] text-[color:var(--accent-text)]">All sources</p>
      </div>
    </section>
  );
}

function FreshEmptyState({ window, sort }: { window: FreshPageData["window"]; sort: FreshPageData["sort"] }) {
  const isDay = window === "24h";
  return (
    <div className="fresh-empty-state">
      <p className="archive-eyebrow">No recent records</p>
      <h2 className="mt-2 text-base font-semibold text-zinc-200">{isDay ? "No archive activity in the last 24 hours." : "No archive activity this week."}</h2>
      <p className="mt-1.5 text-sm text-zinc-500">Fresh uses Character Archive timestamps and never substitutes source upload dates.</p>
      {isDay && <Link href={`/?window=week${sort === "oldest" ? "&sort=oldest" : ""}`} className="archive-button-secondary archive-focus mt-4">View This Week</Link>}
    </div>
  );
}

export function RecentActivityRail({ activity, now }: { activity: FreshPageData["activity"]; now: string }) {
  return (
    <aside className="fresh-activity-rail" aria-labelledby="recent-activity-heading">
      <header className="border-b border-zinc-800 pb-3">
        <p className="archive-eyebrow">Recent</p>
        <h2 id="recent-activity-heading" className="font-interface text-base font-bold uppercase tracking-[0.04em] text-zinc-100">Activity</h2>
        <p className="mt-1 text-[0.68rem] leading-4 text-zinc-600">Current archive timestamps, not a historical audit log.</p>
      </header>
      {activity.length > 0 ? (
        <ol className="divide-y divide-zinc-800/80">
          {activity.map((item) => (
            <li key={item.key} className="py-3">
              <div className="flex items-start gap-2">
                {item.platform ? <SourceBadge platform={item.platform} variant="compact" /> : <span className="font-interface text-[0.58rem] text-zinc-600">{item.kind}</span>}
                <div className="min-w-0 flex-1">
                  <Link href={item.href} className="archive-focus line-clamp-2 rounded-sm text-xs font-semibold leading-4 text-zinc-200 hover:text-violet-300">{item.label}</Link>
                  <p className="font-interface mt-1 text-[0.58rem] uppercase tracking-[0.06em] text-zinc-500">{item.action}</p>
                </div>
                <time dateTime={item.occurredAt} className="font-interface shrink-0 text-[0.58rem] font-bold uppercase text-[color:var(--accent-text)]">{relativeActivityLabel(item.occurredAt, now).replace(" ago", "")}</time>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="py-5 text-xs leading-5 text-zinc-600">No recent archive changes.</p>}
    </aside>
  );
}

function FreshRowSkeleton() {
  return (
    <div className="fresh-feed-row animate-pulse" aria-hidden="true">
      <div className="fresh-row-artwork bg-zinc-900" />
      <div className="fresh-row-main">
        <div className="space-y-2 py-2"><div className="h-4 w-2/3 rounded bg-zinc-800" /><div className="h-2.5 w-1/3 rounded bg-zinc-900" /><div className="h-2.5 w-full rounded bg-zinc-900" /><div className="h-2.5 w-4/5 rounded bg-zinc-900" /><div className="flex gap-1"><span className="h-4 w-12 rounded-full bg-zinc-900" /><span className="h-4 w-16 rounded-full bg-zinc-900" /></div></div>
        <div className="fresh-row-rail"><span className="h-3 w-14 rounded bg-zinc-800" /><span className="mt-2 h-2 w-10 rounded bg-zinc-900" /></div>
      </div>
    </div>
  );
}
