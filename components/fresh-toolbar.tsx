"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { freshHref, type FreshSort, type FreshWindow } from "../src/lib/home/fresh-search";

export function FreshToolbar({ window, sort }: { window: FreshWindow; sort: FreshSort }) {
  const router = useRouter();
  return (
    <div className="fresh-toolbar">
      <div role="group" aria-label="Fresh archive time window" className="flex items-center gap-1">
        <WindowLink label="Last 24h" value="24h" selected={window === "24h"} sort={sort} />
        <WindowLink label="This Week" value="week" selected={window === "week"} sort={sort} />
      </div>
      <label className="fresh-sort-field ml-auto flex items-center gap-2">
        <span className="archive-toolbar-label text-zinc-500">Sort</span>
        <select
          aria-label="Sort Fresh characters"
          value={sort}
          onChange={(event) => router.push(freshHref({ window, sort: event.target.value as FreshSort }))}
          className="archive-input archive-sort-control fresh-sort-control"
        >
          <option value="freshest">Freshest</option>
          <option value="oldest">Oldest activity</option>
        </select>
      </label>
    </div>
  );
}

function WindowLink({
  label,
  value,
  selected,
  sort,
}: {
  label: string;
  value: FreshWindow;
  selected: boolean;
  sort: FreshSort;
}) {
  return (
    <Link
      href={freshHref({ window: value, sort })}
      aria-current={selected ? "page" : undefined}
      className={`fresh-window-control archive-focus ${selected ? "accent-muted" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"}`}
    >
      {label}
    </Link>
  );
}
