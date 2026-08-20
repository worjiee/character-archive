"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { lorebookBrowseHref } from "../src/lib/archive/browse-params";
import type {
  LorebookBrowseFacets,
  LorebookBrowseInput,
  LorebookBrowseResult,
  LorebookBrowseSort,
} from "../src/lib/lorebooks/browse";
import type { PersistedSourcePlatform } from "../src/lib/sources/presentation";
import { LorebookLibraryCard } from "./lorebook-library-card";

export function LorebookLibrary({
  browse,
  facets,
  filters,
}: {
  browse: LorebookBrowseResult;
  facets: LorebookBrowseFacets;
  filters: LorebookBrowseInput;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const selectedSource = filters.sources[0] ?? "";
  const hasFilters = Boolean(filters.query || filters.sources.length);

  function navigate(patch: Partial<LorebookBrowseInput>, options: { preservePage?: boolean } = {}) {
    startTransition(() => router.push(lorebookBrowseHref(filters, patch, options), { scroll: false }));
  }

  function clearFilters() {
    navigate({ query: "", sources: [] });
  }

  return (
    <section className="mt-5" aria-labelledby="lorebook-results-heading" aria-busy={isPending}>
      <h2 id="lorebook-results-heading" className="sr-only">Lorebook results</h2>
      <div className="archive-panel p-3 sm:p-3.5">
        <div className="grid gap-2.5 md:grid-cols-[minmax(14rem,1fr)_12rem_12rem]">
          <LorebookSearchInput key={filters.query} filters={filters} />
          <label><span className="sr-only">Filter lorebooks by source</span><select value={selectedSource} onChange={(event) => navigate({ sources: event.target.value ? [event.target.value as PersistedSourcePlatform] : [] })} className="archive-input py-2 text-xs"><option value="">All sources</option>{facets.sources.map((option) => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}</select></label>
          <label><span className="sr-only">Sort lorebooks</span><select value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as LorebookBrowseSort })} className="archive-input py-2 text-xs"><option value="updated">Recently updated</option><option value="newest">Newest added</option><option value="oldest">Oldest added</option><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option></select></label>
        </div>
        <div className="mt-3 flex min-h-7 items-center gap-3 border-t border-zinc-800 pt-3"><p aria-live="polite" className="text-[11px] tabular-nums text-zinc-500">{pageRange(browse)} of {browse.pagination.totalItems} lorebooks</p>{hasFilters && <button type="button" onClick={clearFilters} className="archive-focus ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">Clear filters</button>}</div>
      </div>

      {browse.items.length > 0 ? <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3 sm:gap-3.5">{browse.items.map((lorebook) => <LorebookLibraryCard key={lorebook.id} lorebook={lorebook} />)}</div> : <LorebookNoResults browse={browse} filters={filters} onClear={clearFilters} />}
      <LorebookPagination browse={browse} filters={filters} />
    </section>
  );
}

function LorebookSearchInput({ filters }: { filters: LorebookBrowseInput }) {
  const router = useRouter();
  const [draft, setDraft] = useState(filters.query);
  const [pending, startSearchTransition] = useTransition();
  useEffect(() => {
    if (draft === filters.query) return;
    const timeout = window.setTimeout(() => {
      startSearchTransition(() => router.replace(lorebookBrowseHref(filters, { query: draft }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [draft, filters, router]);
  return <label className="relative min-w-0" aria-busy={pending}><span className="sr-only">Search lorebooks by title or description</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input value={draft} onChange={(event) => setDraft(event.target.value)} className="archive-input pl-9" placeholder="Search title or description" /></label>;
}

function LorebookPagination({ browse, filters }: { browse: LorebookBrowseResult; filters: LorebookBrowseInput }) {
  const { pagination } = browse;
  if (pagination.totalPages <= 1 && pagination.page <= 1) return null;
  return <nav aria-label="Lorebook pages" className="mt-5 flex items-center justify-between gap-3"><div>{pagination.hasPrevious && <Link href={lorebookBrowseHref(filters, { page: pagination.page - 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">← Previous</Link>}</div><p className="text-xs tabular-nums text-zinc-500">Page {pagination.page}{pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}</p><div>{pagination.hasNext && <Link href={lorebookBrowseHref(filters, { page: pagination.page + 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">Next →</Link>}</div></nav>;
}

function LorebookNoResults({ browse, filters, onClear }: { browse: LorebookBrowseResult; filters: LorebookBrowseInput; onClear: () => void }) {
  const beyond = browse.pagination.totalItems > 0 && browse.pagination.totalPages > 0 && browse.pagination.page > browse.pagination.totalPages;
  return <div className="archive-panel mt-3 grid min-h-64 place-items-center border-dashed px-6 py-12 text-center"><div><p className="archive-eyebrow">{beyond ? "Page unavailable" : "No matches"}</p><h2 className="mt-2 text-base font-semibold text-zinc-200">{beyond ? "This page is outside the available results" : "No lorebooks match these filters"}</h2><p className="mt-2 text-sm text-zinc-500">{beyond ? "Return to the first page to continue browsing." : "Try a different search or source."}</p>{beyond ? <Link href={lorebookBrowseHref(filters, { page: 1 }, { preservePage: true })} className="archive-button-secondary archive-focus mt-5">Go to first page</Link> : <button type="button" onClick={onClear} className="archive-button-secondary archive-focus mt-5">Clear filters</button>}</div></div>;
}

function pageRange(browse: LorebookBrowseResult): string {
  if (browse.items.length === 0) return "0";
  const start = (browse.pagination.page - 1) * browse.pagination.pageSize + 1;
  return `${start}–${start + browse.items.length - 1}`;
}
