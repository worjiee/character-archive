"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { characterBrowseHref } from "../src/lib/archive/browse-params";
import type {
  CharacterBrowseFacets,
  CharacterBrowseInput,
  CharacterBrowseResult,
  CharacterBrowseSort,
} from "../src/lib/characters/browse";
import { CharacterCardGrid } from "./character-card-grid";
import { CharacterSourceNavigation } from "./character-source-navigation";
import {
  activeCharacterFilterCount,
  buildCharacterSourceNavigation,
  selectedSourceNavigationKey,
  showModalWhenClosed,
  sourceFiltersForNavigation,
  type CharacterLibraryFilterOptions,
  type CharacterSourceNavigationKey,
} from "./character-library-utils";

export function CharacterLibrary({
  browse,
  facets,
  filters,
}: {
  browse: CharacterBrowseResult;
  facets: CharacterBrowseFacets;
  filters: CharacterBrowseInput;
}) {
  const router = useRouter();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const options: CharacterLibraryFilterOptions = { tags: facets.tags, platforms: facets.sources, statuses: facets.statuses };
  const sourceNavigation = useMemo(() => buildCharacterSourceNavigation(facets.total, facets.sources), [facets]);
  const activeCount = activeCharacterFilterCount(filters);
  const selectedSourceKey = selectedSourceNavigationKey(filters.sources);

  function navigate(patch: Partial<CharacterBrowseInput>, options: { replace?: boolean; preservePage?: boolean } = {}) {
    const href = characterBrowseHref(filters, patch, { preservePage: options.preservePage });
    startTransition(() => options.replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }));
  }

  function clearFilters() {
    navigate({ query: "", sources: [], tags: [], statuses: [] });
  }

  function selectSource(key: CharacterSourceNavigationKey) {
    const sources = sourceFiltersForNavigation(key);
    if (sources !== null) navigate({ sources });
  }

  return (
    <div className="mt-5" aria-busy={isPending}>
      <CharacterSourceNavigation items={sourceNavigation} selectedKey={selectedSourceKey} onSelect={selectSource} />

      <div className="mt-3 grid items-start gap-5 lg:grid-cols-[14.5rem_minmax(0,1fr)]">
        <aside className="archive-panel sticky top-[4.5rem] hidden max-h-[calc(100vh-5.5rem)] overflow-y-auto p-4 lg:block" aria-label="Character filters">
          <FilterPanel filters={filters} options={options} onChange={(patch) => navigate(patch)} onClear={clearFilters} idPrefix="desktop" />
        </aside>

        <section className="min-w-0" aria-label="Character results">
          <div className="archive-panel p-3 sm:p-3.5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <CharacterSearchInput key={filters.query} filters={filters} />
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setMobileFiltersOpen(true)} className="archive-button-secondary archive-focus flex-1 lg:hidden">Filters{activeCount > 0 && <span className="accent-muted rounded-full border px-1.5 py-0.5 text-[10px]">{activeCount}</span>}</button>
                <label className="min-w-0 flex-1 md:flex-none"><span className="sr-only">Sort characters</span><select value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as CharacterBrowseSort })} className="archive-input min-w-[10.5rem] py-2 text-xs"><option value="updated">Recently updated</option><option value="newest">Newest added</option><option value="oldest">Oldest added</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option></select></label>
              </div>
            </div>
            <div className="mt-3 flex min-h-7 flex-wrap items-center gap-1.5 border-t border-zinc-800 pt-3">
              <span className="mr-1 text-[11px] tabular-nums text-zinc-500">{pageRange(browse)} of {browse.pagination.totalItems}</span>
              <ActiveFilterChips filters={filters} options={options} onChange={(patch) => navigate(patch)} />
              {activeCount > 0 && <button type="button" onClick={clearFilters} className="archive-focus ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">Clear all</button>}
            </div>
          </div>

          {browse.items.length > 0 ? <CharacterCardGrid characters={browse.items} className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3 sm:gap-3.5" /> : <CharacterNoResults browse={browse} filters={filters} onClear={clearFilters} />}
          <CharacterPagination browse={browse} filters={filters} />
        </section>

        {mobileFiltersOpen && <MobileFilterDialog filters={filters} options={options} onChange={(patch) => navigate(patch)} onClear={clearFilters} onClose={() => setMobileFiltersOpen(false)} />}
      </div>
    </div>
  );
}

function CharacterSearchInput({ filters }: { filters: CharacterBrowseInput }) {
  const router = useRouter();
  const [draft, setDraft] = useState(filters.query);
  const [pending, startSearchTransition] = useTransition();
  useEffect(() => {
    if (draft === filters.query) return;
    const timeout = window.setTimeout(() => {
      startSearchTransition(() => router.replace(characterBrowseHref(filters, { query: draft }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [draft, filters, router]);
  return <label className="relative min-w-0 flex-1" aria-busy={pending}><span className="sr-only">Search characters or creators</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input value={draft} onChange={(event) => setDraft(event.target.value)} className="archive-input pl-9" placeholder="Search characters or creators" /></label>;
}

function FilterPanel({ filters, options, onChange, onClear, idPrefix }: { filters: CharacterBrowseInput; options: CharacterLibraryFilterOptions; onChange: (patch: Partial<CharacterBrowseInput>) => void; onClear: () => void; idPrefix: string }) {
  const selectedCount = filters.tags.length + filters.sources.length + filters.statuses.length;
  return <div><div className="flex items-center justify-between gap-3"><div><p className="archive-eyebrow">Refine</p><h2 className="mt-1 text-sm font-semibold text-zinc-100">Filters</h2></div>{selectedCount > 0 && <button type="button" onClick={onClear} className="archive-focus rounded px-1.5 py-1 text-[11px] text-zinc-500 hover:text-violet-300">Reset</button>}</div><FilterGroup title="Source" values={options.platforms} selected={filters.sources} idPrefix={`${idPrefix}-source`} onToggle={(value) => onChange({ sources: toggleValue(filters.sources, value) as CharacterBrowseInput["sources"] })} /><FilterGroup title="Status" values={options.statuses} selected={filters.statuses} idPrefix={`${idPrefix}-status`} onToggle={(value) => onChange({ statuses: toggleValue(filters.statuses, value) as CharacterBrowseInput["statuses"] })} /><FilterGroup title="Tags" values={options.tags} selected={filters.tags} idPrefix={`${idPrefix}-tag`} onToggle={(value) => onChange({ tags: toggleValue(filters.tags, value) })} scroll /></div>;
}

function FilterGroup({ title, values, selected, idPrefix, onToggle, scroll = false }: { title: string; values: Array<{ value: string; label: string; count: number }>; selected: readonly string[]; idPrefix: string; onToggle: (value: string) => void; scroll?: boolean }) {
  return <fieldset className="mt-4 border-t border-zinc-800 pt-4"><legend className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">{title}</legend><div className={`mt-2 space-y-0.5 ${scroll ? "max-h-60 overflow-y-auto pr-1" : ""}`}>{values.map((option) => { const id = `${idPrefix}-${option.value}`; return <label key={option.value} htmlFor={id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"><input id={id} type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)} className="h-3.5 w-3.5 accent-[var(--accent-color)]" /><span className="min-w-0 flex-1 truncate">{option.label}</span><span className="text-[10px] tabular-nums text-zinc-600">{option.count}</span></label>; })}{values.length === 0 && <p className="px-2 py-2 text-xs text-zinc-600">None available</p>}</div></fieldset>;
}

function ActiveFilterChips({ filters, options, onChange }: { filters: CharacterBrowseInput; options: CharacterLibraryFilterOptions; onChange: (patch: Partial<CharacterBrowseInput>) => void }) {
  const groups = [
    { values: filters.sources as string[], options: options.platforms, remove: (value: string) => onChange({ sources: filters.sources.filter((item) => item !== value) }) },
    { values: filters.statuses as string[], options: options.statuses, remove: (value: string) => onChange({ statuses: filters.statuses.filter((item) => item !== value) }) },
    { values: filters.tags, options: options.tags, remove: (value: string) => onChange({ tags: filters.tags.filter((item) => item !== value) }) },
  ];
  return groups.flatMap((group) => group.values.map((value) => { const label = group.options.find((option) => option.value === value)?.label ?? value; return <button key={`${label}-${value}`} type="button" onClick={() => group.remove(value)} className="archive-chip archive-focus" data-selected="true">{label}<span aria-hidden="true">×</span><span className="sr-only">Remove {label} filter</span></button>; }));
}

function MobileFilterDialog({ filters, options, onChange, onClear, onClose }: { filters: CharacterBrowseInput; options: CharacterLibraryFilterOptions; onChange: (patch: Partial<CharacterBrowseInput>) => void; onClear: () => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (dialogRef.current) showModalWhenClosed(dialogRef.current); }, []);
  return <dialog ref={dialogRef} aria-label="Character filters" onClose={onClose} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }} className="m-0 ml-auto h-dvh w-[min(22rem,calc(100vw-1rem))] max-w-none border-l border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl"><div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3"><h2 className="text-sm font-semibold">Filter characters</h2><button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close filters" className="archive-focus grid h-9 w-9 place-items-center rounded-lg text-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">×</button></div><div className="min-h-0 flex-1 overflow-y-auto p-4"><FilterPanel filters={filters} options={options} onChange={onChange} onClear={onClear} idPrefix="mobile" /></div><div className="grid grid-cols-2 gap-2 border-t border-zinc-800 p-4"><button type="button" onClick={onClear} className="archive-button-secondary archive-focus">Clear</button><button type="button" onClick={() => dialogRef.current?.close()} className="archive-button-primary archive-focus">Show results</button></div></div></dialog>;
}

function CharacterPagination({ browse, filters }: { browse: CharacterBrowseResult; filters: CharacterBrowseInput }) {
  const { pagination } = browse;
  if (pagination.totalPages <= 1 && pagination.page <= 1) return null;
  return <nav aria-label="Character pages" className="mt-5 flex items-center justify-between gap-3"><div>{pagination.hasPrevious && <Link href={characterBrowseHref(filters, { page: pagination.page - 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">← Previous</Link>}</div><p className="text-xs tabular-nums text-zinc-500">Page {pagination.page}{pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}</p><div>{pagination.hasNext && <Link href={characterBrowseHref(filters, { page: pagination.page + 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">Next →</Link>}</div></nav>;
}

function CharacterNoResults({ browse, filters, onClear }: { browse: CharacterBrowseResult; filters: CharacterBrowseInput; onClear: () => void }) {
  const beyond = browse.pagination.totalItems > 0 && browse.pagination.totalPages > 0 && browse.pagination.page > browse.pagination.totalPages;
  return <div className="archive-panel mt-3 grid min-h-72 place-items-center border-dashed px-6 py-12 text-center"><div><p className="archive-eyebrow">{beyond ? "Page unavailable" : "No matches"}</p><h2 className="mt-2 text-base font-semibold text-zinc-200">{beyond ? "This page is outside the available results" : "No characters match these filters"}</h2><p className="mt-2 text-sm text-zinc-500">{beyond ? "Return to the first page to continue browsing." : "Adjust the search or clear the selected filters."}</p>{beyond ? <Link href={characterBrowseHref(filters, { page: 1 }, { preservePage: true })} className="archive-button-secondary archive-focus mt-5">Go to first page</Link> : <button type="button" onClick={onClear} className="archive-button-secondary archive-focus mt-5">Clear filters</button>}</div></div>;
}

function pageRange(browse: CharacterBrowseResult): string {
  if (browse.items.length === 0) return "0";
  const start = (browse.pagination.page - 1) * browse.pagination.pageSize + 1;
  return `${start}–${start + browse.items.length - 1}`;
}

function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
