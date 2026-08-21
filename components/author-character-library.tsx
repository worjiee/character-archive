"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { AuthorCharacterFacets } from "../src/lib/authors/browse";
import { authorCharacterBrowseHref } from "../src/lib/authors/params";
import type {
  CharacterBrowseAuthorScope,
  CharacterBrowseInput,
  CharacterBrowseResult,
  CharacterBrowseSort,
} from "../src/lib/characters/browse";
import { CharacterCardGrid } from "./character-card-grid";

export function AuthorCharacterLibrary({
  author,
  browse,
  facets,
  filters,
}: {
  author: CharacterBrowseAuthorScope;
  browse: CharacterBrowseResult;
  facets: AuthorCharacterFacets;
  filters: CharacterBrowseInput;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const activeFilterCount = filters.tags.length + filters.statuses.length;

  function navigate(
    patch: Partial<CharacterBrowseInput>,
    options: { replace?: boolean; preservePage?: boolean } = {},
  ) {
    const href = authorCharacterBrowseHref(author, filters, patch, { preservePage: options.preservePage });
    startTransition(() => options.replace
      ? router.replace(href, { scroll: false })
      : router.push(href, { scroll: false }));
  }

  function clearFilters() {
    navigate({ query: "", tags: [], statuses: [] });
  }

  if (facets.total === 0) {
    return (
      <div className="archive-panel mt-5 grid min-h-64 place-items-center border-dashed px-6 py-12 text-center">
        <div><p className="archive-eyebrow">No visible characters</p><h2 className="mt-2 text-base font-semibold text-zinc-200">This author has no non-deleted characters</h2><p className="mt-2 text-sm text-zinc-500">Deleted records remain excluded from author browsing.</p></div>
      </div>
    );
  }

  return (
    <section className="mt-5" aria-labelledby="author-characters-heading" aria-busy={isPending}>
      <h2 id="author-characters-heading" className="sr-only">Author characters</h2>
      <div className="archive-panel p-3 sm:p-3.5">
        <div className="grid gap-2.5 md:grid-cols-[minmax(14rem,1fr)_12rem]">
          <CharacterSearchInput key={filters.query} author={author} filters={filters} />
          <label>
            <span className="sr-only">Sort this author&apos;s characters</span>
            <select value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as CharacterBrowseSort })} className="archive-input py-2 text-xs">
              <option value="updated">Recently updated</option>
              <option value="newest">Newest added</option>
              <option value="oldest">Oldest added</option>
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
            </select>
          </label>
        </div>

        <details className="group mt-3 border-t border-zinc-800 pt-3" open={activeFilterCount > 0 || undefined}>
          <summary className="archive-focus flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold text-zinc-400 marker:hidden hover:text-zinc-100">
            Filter this author&apos;s characters
            {activeFilterCount > 0 && <span className="accent-muted rounded-full border px-1.5 py-0.5 text-[10px]">{activeFilterCount}</span>}
            <span aria-hidden="true" className="ml-auto transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="mt-3 grid gap-4 border-t border-zinc-800 pt-3 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <FilterGroup title="Status" options={facets.statuses} selected={filters.statuses} onToggle={(value) => navigate({ statuses: toggle(filters.statuses, value) as CharacterBrowseInput["statuses"] })} />
            <FilterGroup title="Tags from this author" options={facets.tags} selected={filters.tags} onToggle={(value) => navigate({ tags: toggle(filters.tags, value) })} scroll />
          </div>
        </details>

        <div className="mt-3 flex min-h-7 flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
          <p className="text-[11px] tabular-nums text-zinc-500">{pageRange(browse)} of {browse.pagination.totalItems} characters</p>
          {(filters.query || activeFilterCount > 0) && <button type="button" onClick={clearFilters} className="archive-focus ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">Clear filters</button>}
        </div>
      </div>

      {browse.items.length > 0 ? (
        <CharacterCardGrid characters={browse.items} className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3 sm:gap-3.5" />
      ) : (
        <CharacterNoResults author={author} browse={browse} filters={filters} onClear={clearFilters} />
      )}
      <CharacterPagination author={author} browse={browse} filters={filters} />
    </section>
  );
}

function CharacterSearchInput({ author, filters }: { author: CharacterBrowseAuthorScope; filters: CharacterBrowseInput }) {
  const router = useRouter();
  const [draft, setDraft] = useState(filters.query);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (draft === filters.query) return;
    const timeout = window.setTimeout(() => {
      startTransition(() => router.replace(authorCharacterBrowseHref(author, filters, { query: draft }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [author, draft, filters, router]);
  return <label className="relative min-w-0" aria-busy={pending}><span className="sr-only">Search this author&apos;s characters</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input value={draft} onChange={(event) => setDraft(event.target.value)} className="archive-input pl-9" placeholder="Search this author’s characters" /></label>;
}

function FilterGroup({ title, options, selected, onToggle, scroll = false }: { title: string; options: Array<{ value: string; label: string; count: number }>; selected: readonly string[]; onToggle: (value: string) => void; scroll?: boolean }) {
  return <fieldset><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{title}</legend><div className={`mt-2 flex flex-wrap gap-1.5 ${scroll ? "max-h-40 overflow-y-auto pr-1" : ""}`}>{options.map((option) => <button key={option.value} type="button" aria-pressed={selected.includes(option.value)} onClick={() => onToggle(option.value)} className="archive-chip archive-focus" data-selected={selected.includes(option.value) ? "true" : undefined}>{option.label}<span className="text-[9px] tabular-nums opacity-65">{option.count}</span></button>)}{options.length === 0 && <p className="text-xs text-zinc-600">None available</p>}</div></fieldset>;
}

function CharacterPagination({ author, browse, filters }: { author: CharacterBrowseAuthorScope; browse: CharacterBrowseResult; filters: CharacterBrowseInput }) {
  const { pagination } = browse;
  if (pagination.totalPages <= 1 && pagination.page <= 1) return null;
  return <nav aria-label="Author character pages" className="mt-5 flex items-center justify-between gap-3"><div>{pagination.hasPrevious && <Link href={authorCharacterBrowseHref(author, filters, { page: pagination.page - 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">← Previous</Link>}</div><p className="text-xs tabular-nums text-zinc-500">Page {pagination.page}{pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}</p><div>{pagination.hasNext && <Link href={authorCharacterBrowseHref(author, filters, { page: pagination.page + 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">Next →</Link>}</div></nav>;
}

function CharacterNoResults({ author, browse, filters, onClear }: { author: CharacterBrowseAuthorScope; browse: CharacterBrowseResult; filters: CharacterBrowseInput; onClear: () => void }) {
  const beyond = browse.pagination.totalItems > 0 && browse.pagination.totalPages > 0 && browse.pagination.page > browse.pagination.totalPages;
  return <div className="archive-panel mt-3 grid min-h-64 place-items-center border-dashed px-6 py-12 text-center"><div><p className="archive-eyebrow">{beyond ? "Page unavailable" : "No matches"}</p><h2 className="mt-2 text-base font-semibold text-zinc-200">{beyond ? "This page is outside the available results" : "No characters match these author filters"}</h2><p className="mt-2 text-sm text-zinc-500">{beyond ? "Return to the first page to continue browsing." : "Try another search or remove a tag or status filter."}</p>{beyond ? <Link href={authorCharacterBrowseHref(author, filters, { page: 1 }, { preservePage: true })} className="archive-button-secondary archive-focus mt-5">Go to first page</Link> : <button type="button" onClick={onClear} className="archive-button-secondary archive-focus mt-5">Clear filters</button>}</div></div>;
}

function pageRange(browse: CharacterBrowseResult): string {
  if (browse.items.length === 0) return "0";
  const start = (browse.pagination.page - 1) * browse.pagination.pageSize + 1;
  return `${start}–${start + browse.items.length - 1}`;
}

function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
