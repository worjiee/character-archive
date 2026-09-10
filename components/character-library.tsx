"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { characterBrowseHref } from "../src/lib/archive/browse-params";
import type {
  CharacterBrowseFacets,
  CharacterBrowseInput,
  CharacterBrowseResult,
  CharacterBrowseSort,
} from "../src/lib/characters/browse";
import type { PersistedSourcePlatform } from "../src/lib/sources/presentation";
import type {
  SelectedTagOption,
  TagSearchItem,
  TagSearchResult,
  TagVocabularySource,
} from "../src/lib/tags/contracts";
import { CharacterCardGrid } from "./character-card-grid";
import { SourceBadge } from "./character-badges";
import {
  activeCharacterFilterCount,
  buildCharacterSourceNavigation,
  showModalWhenClosed,
  type CharacterLibraryFilterOptions,
} from "./character-library-utils";

export function CharacterLibrary({ browse, facets, filters, initialTagSearch, selectedTags }: {
  browse: CharacterBrowseResult;
  facets: CharacterBrowseFacets;
  filters: CharacterBrowseInput;
  initialTagSearch: TagSearchResult;
  selectedTags: SelectedTagOption[];
}) {
  const router = useRouter();
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const options: CharacterLibraryFilterOptions = { platforms: facets.sources, statuses: facets.statuses };
  const [interactionTagLabels, setInteractionTagLabels] = useState<Record<string, string>>({});
  const selectedTagLabels = useMemo(() => ({
    ...Object.fromEntries(selectedTags.map((tag) => [tag.slug, tag.label])),
    ...interactionTagLabels,
  }), [interactionTagLabels, selectedTags]);
  const activeCount = activeCharacterFilterCount(filters);
  const selectionContext = characterSelectionContextKey(filters);

  function navigate(patch: Partial<CharacterBrowseInput>, options: { replace?: boolean; preservePage?: boolean } = {}) {
    setMobileFiltersOpen(false);
    const href = characterBrowseHref(filters, patch, { preservePage: options.preservePage });
    startTransition(() => options.replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }));
  }

  function clearFilters() {
    navigate({ query: "", sources: [], tags: [], statuses: [] });
  }

  function toggleTag(item: TagSearchItem) {
    setInteractionTagLabels((current) => ({ ...current, [item.slug]: item.displayLabel }));
    navigate({ tags: toggleValue(filters.tags, item.slug) });
  }

  return (
    <div className="characters-browser" aria-busy={isPending}>
      <div className="characters-browser-layout">
        <aside className="characters-filter-rail" aria-label="Character filters">
          <FilterPanel filters={filters} options={options} total={facets.total} initialTagSearch={initialTagSearch} onChange={(patch) => navigate(patch)} onTagToggle={toggleTag} onClear={clearFilters} idPrefix="desktop" />
        </aside>

        <section className="min-w-0" aria-label="Character results">
          <div className="characters-search-row">
            <CharacterSearchInput key={filters.query} filters={filters} />
          </div>

          <div className="characters-results-toolbar">
            <div className="characters-filter-summary flex min-w-0 flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-controls="character-mobile-filters"
                aria-expanded={mobileFiltersOpen}
                aria-haspopup="dialog"
                onClick={() => setMobileFiltersOpen(true)}
                className="characters-mobile-filter archive-focus"
              >Filter{activeCount > 0 && <span>{activeCount}</span>}</button>
              <span className="archive-toolbar-label hidden text-zinc-500 sm:inline">Filter</span>
              <ActiveFilterChips filters={filters} options={options} selectedTagLabels={selectedTagLabels} onChange={(patch) => navigate(patch)} />
              {activeCount > 0 && <button type="button" onClick={clearFilters} className="characters-clear-filters archive-focus">Clear all</button>}
            </div>
            <label className="characters-sort-field">
              <span className="archive-toolbar-label text-zinc-500">Sort</span>
              <select value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as CharacterBrowseSort })} className="archive-input archive-sort-control characters-sort-control">
                <option value="updated">Freshest activity</option>
                <option value="updated-oldest">Oldest activity</option>
                <option value="newest">Newest added</option>
                <option value="oldest">Oldest added</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            </label>
          </div>

          <div className="characters-result-meta">
            <span>{pageRange(browse)} of {browse.pagination.totalItems} characters</span>
            <span>Page selection only</span>
          </div>

          {browse.items.length > 0 ? (
            <CharacterCardGrid key={selectionContext} characters={browse.items} selectable />
          ) : (
            <CharacterNoResults browse={browse} filters={filters} onClear={clearFilters} />
          )}
          <CharacterPagination browse={browse} filters={filters} />
        </section>

        {mobileFiltersOpen && <MobileFilterDialog filters={filters} options={options} total={facets.total} initialTagSearch={initialTagSearch} onChange={(patch) => navigate(patch)} onTagToggle={toggleTag} onClear={clearFilters} onClose={() => setMobileFiltersOpen(false)} />}
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
  return <label className="characters-search-field" aria-busy={pending}><span className="sr-only">Search characters or creators</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg><input type="search" value={draft} onChange={(event) => setDraft(event.target.value)} className="archive-input" placeholder="Search characters or creators" /></label>;
}

function FilterPanel({ filters, options, total, initialTagSearch, onChange, onTagToggle, onClear, idPrefix }: {
  filters: CharacterBrowseInput;
  options: CharacterLibraryFilterOptions;
  total: number;
  initialTagSearch: TagSearchResult;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
  onTagToggle: (item: TagSearchItem) => void;
  onClear: () => void;
  idPrefix: string;
}) {
  const selectedCount = filters.tags.length + filters.sources.length + filters.statuses.length;
  return (
    <div>
      <div className="characters-filter-heading"><div><p>Filter by</p><h2>Characters</h2></div>{selectedCount > 0 && <button type="button" onClick={onClear} className="archive-focus">Reset</button>}</div>
      <SourceFilterGroup total={total} facets={options.platforms} selected={filters.sources} onChange={(sources) => onChange({ sources })} />
      <TagFilterGroup
        key={`${idPrefix}-${filters.tagSource}`}
        initialResult={initialTagSearch}
        source={filters.tagSource}
        selected={filters.tags}
        idPrefix={`${idPrefix}-tag`}
        onSourceChange={(tagSource) => onChange({ tagSource })}
        onToggle={onTagToggle}
      />
      <FilterGroup title="Status" values={options.statuses} selected={filters.statuses} idPrefix={`${idPrefix}-status`} onToggle={(value) => onChange({ statuses: toggleValue(filters.statuses, value) as CharacterBrowseInput["statuses"] })} />
    </div>
  );
}

function SourceFilterGroup({ total, facets, selected, onChange }: {
  total: number;
  facets: CharacterBrowseFacets["sources"];
  selected: readonly PersistedSourcePlatform[];
  onChange: (sources: PersistedSourcePlatform[]) => void;
}) {
  const requested = buildCharacterSourceNavigation(total, facets);
  const other = facets.find((facet) => facet.value === "OTHER" && facet.count > 0);
  return (
    <fieldset className="characters-filter-group">
      <legend>Sources</legend>
      <div className="characters-source-options">
        {requested.map((item) => {
          const isAll = item.key === "ALL";
          const pressed = isAll ? selected.length === 0 : selected.includes(item.key as PersistedSourcePlatform);
          return <button key={item.key} type="button" aria-pressed={pressed} disabled={item.disabled} title={item.disabled ? "Coming soon" : undefined} onClick={() => {
            if (isAll) onChange([]);
            else if (!item.disabled) onChange(toggleValue(selected, item.key) as PersistedSourcePlatform[]);
          }} className="archive-focus">
            <span className="flex min-w-0 items-center gap-2">{!isAll && <SourceBadge platform={item.key} variant="compact" />}<span className="truncate">{item.label}</span></span>
            <span>{item.count ?? "Soon"}</span>
          </button>;
        })}
        {other && <button type="button" aria-pressed={selected.includes("OTHER")} onClick={() => onChange(toggleValue(selected, "OTHER") as PersistedSourcePlatform[])} className="archive-focus"><span className="flex items-center gap-2"><SourceBadge platform="OTHER" variant="compact" />Other</span><span>{other.count}</span></button>}
      </div>
    </fieldset>
  );
}

function TagFilterGroup({ initialResult, source, selected, idPrefix, onSourceChange, onToggle }: {
  initialResult: TagSearchResult;
  source: TagVocabularySource;
  selected: readonly string[];
  idPrefix: string;
  onSourceChange: (source: TagVocabularySource) => void;
  onToggle: (item: TagSearchItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(initialResult);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const loadPage = useCallback(async (page: number, searchQuery: string) => {
    const currentRequest = ++requestId.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        source,
        page: String(page),
        limit: "50",
      });
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      const response = await fetch(`/api/tags?${params.toString()}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("Tag search request failed.");
      const next = await response.json() as TagSearchResult;
      if (currentRequest === requestId.current) setResult(next);
    } catch (requestError) {
      if (!(requestError instanceof DOMException && requestError.name === "AbortError") && currentRequest === requestId.current) {
        setError("Tag search is temporarily unavailable.");
      }
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [source]);

  useEffect(() => {
    if (!query.trim()) return;
    const timeout = window.setTimeout(() => void loadPage(1, query), 250);
    return () => window.clearTimeout(timeout);
  }, [loadPage, query]);

  useEffect(() => () => requestController.current?.abort(), []);

  const groups = groupTagResults(result.items);
  return (
    <fieldset className="characters-filter-group">
      <legend>Tags</legend>
      <label className="characters-tag-search">
        <span className="sr-only">Search all tags</span>
        <input type="search" value={query} onChange={(event) => {
          const nextQuery = event.target.value;
          setQuery(nextQuery);
          if (!nextQuery.trim()) {
            requestController.current?.abort();
            requestId.current += 1;
            setResult(initialResult);
            setLoading(false);
            setError(null);
          }
        }} placeholder="Search all tags..." aria-label="Search all tags" />
      </label>
      <TagSourceControl source={source} onChange={onSourceChange} />
      <p className="characters-filter-hint">Matches any selected tag</p>
      <div className="characters-tag-result-region" aria-busy={loading}>
        {groups.map(([group, items]) => (
          <section key={group} className="characters-tag-section" aria-labelledby={`${idPrefix}-group-${group}`}>
            <h3 id={`${idPrefix}-group-${group}`}>{group}</h3>
            <div className="characters-filter-options">
              {items.map((item, index) => (
                <TagFilterOption
                  key={`${item.tagId}-${item.displayLabel}`}
                  item={item}
                  checked={selected.includes(item.slug)}
                  id={`${idPrefix}-${item.tagId}-${index}`}
                  onToggle={() => onToggle(item)}
                />
              ))}
            </div>
          </section>
        ))}
        {!loading && !error && result.items.length === 0 && (
          <div className="characters-tag-empty"><strong>No tags found</strong><span>Try another search or source vocabulary.</span></div>
        )}
        {loading && <p className="characters-tag-status" role="status">Searching tags…</p>}
        {error && <p className="characters-tag-status" role="alert">{error}</p>}
      </div>
      <div className="characters-tag-pagination" aria-label="Tag result pages">
        <button type="button" disabled={loading || result.page <= 1} onClick={() => void loadPage(result.page - 1, query)} className="archive-focus">Previous</button>
        <span>{result.total === 0 ? "0 tags" : `Page ${result.page} · ${result.total} tags`}</span>
        <button type="button" disabled={loading || !result.hasMore} onClick={() => void loadPage(result.page + 1, query)} className="archive-focus">Show more</button>
      </div>
    </fieldset>
  );
}

function TagSourceControl({ source, onChange }: {
  source: TagVocabularySource;
  onChange: (source: TagVocabularySource) => void;
}) {
  const choices: Array<{ value: TagVocabularySource | "JANNY"; label: string; disabled?: boolean }> = [
    { value: "ALL", label: "All" },
    { value: "JANITOR_AI", label: "Janitor AI" },
    { value: "JANNY", label: "Janny", disabled: true },
    { value: "SAUCEPAN", label: "Saucepan" },
    { value: "DATACAT", label: "Datacat" },
  ];
  return (
    <fieldset className="characters-tag-source" aria-label="Tag source">
      <legend>Tag source</legend>
      <div className="characters-tag-source-options">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={!choice.disabled && source === choice.value}
            aria-label={choice.disabled ? `${choice.label}, coming soon` : choice.label}
            disabled={choice.disabled}
            title={choice.disabled ? "Coming soon" : undefined}
            onClick={() => { if (!choice.disabled) onChange(choice.value as TagVocabularySource); }}
            className="archive-focus"
          >{choice.label}</button>
        ))}
      </div>
    </fieldset>
  );
}

function TagFilterOption({ item, checked, id, onToggle }: {
  item: TagSearchItem;
  checked: boolean;
  id: string;
  onToggle: () => void;
}) {
  return (
    <label htmlFor={id} className="characters-filter-option">
      <input id={id} type="checkbox" checked={checked} onChange={onToggle} aria-label={`${item.displayLabel}, ${item.count} characters`} />
      <span className="min-w-0 flex-1">{item.displayLabel}</span>
      <span>{item.count}</span>
    </label>
  );
}

function groupTagResults(items: TagSearchItem[]): Array<[string, TagSearchItem[]]> {
  const groups = new Map<string, TagSearchItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups.entries()];
}

function FilterGroup({ title, values, selected, idPrefix, onToggle }: {
  title: string;
  values: Array<{ value: string; label: string; count: number }>;
  selected: readonly string[];
  idPrefix: string;
  onToggle: (value: string) => void;
}) {
  return <fieldset className="characters-filter-group"><legend>{title}</legend><div className="characters-filter-options">{values.map((option) => <FilterOption key={option.value} option={option} checked={selected.includes(option.value)} id={`${idPrefix}-${option.value}`} onToggle={() => onToggle(option.value)} />)}</div></fieldset>;
}

function FilterOption({ option, checked, id, onToggle }: { option: { value: string; label: string; count: number }; checked: boolean; id: string; onToggle: () => void }) {
  return <label htmlFor={id} className="characters-filter-option"><input id={id} type="checkbox" checked={checked} onChange={onToggle} /><span className="min-w-0 flex-1 truncate">{option.label}</span><span>{option.count}</span></label>;
}

function ActiveFilterChips({ filters, options, selectedTagLabels, onChange }: {
  filters: CharacterBrowseInput;
  options: CharacterLibraryFilterOptions;
  selectedTagLabels: Record<string, string>;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  const groups = [
    { values: filters.sources as string[], options: options.platforms, remove: (value: string) => onChange({ sources: filters.sources.filter((item) => item !== value) }) },
    { values: filters.statuses as string[], options: options.statuses, remove: (value: string) => onChange({ statuses: filters.statuses.filter((item) => item !== value) }) },
    { values: filters.tags, options: filters.tags.map((value) => ({ value, label: selectedTagLabels[value] ?? value, count: 0 })), remove: (value: string) => onChange({ tags: filters.tags.filter((item) => item !== value) }) },
  ];
  return groups.flatMap((group) => group.values.map((value) => { const label = group.options.find((option) => option.value === value)?.label ?? value; return <button key={`${label}-${value}`} type="button" onClick={() => group.remove(value)} className="archive-chip archive-focus" data-selected="true">{label}<span aria-hidden="true">×</span><span className="sr-only">Remove {label} filter</span></button>; }));
}

function MobileFilterDialog({ filters, options, total, initialTagSearch, onChange, onTagToggle, onClear, onClose }: {
  filters: CharacterBrowseInput;
  options: CharacterLibraryFilterOptions;
  total: number;
  initialTagSearch: TagSearchResult;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
  onTagToggle: (item: TagSearchItem) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow;
    if (dialogRef.current) showModalWhenClosed(dialogRef.current);
    document.documentElement.style.overflow = "hidden";
    return () => { document.documentElement.style.overflow = previousOverflow; };
  }, []);
  return <dialog id="character-mobile-filters" ref={dialogRef} aria-label="Character filters" onClose={onClose} onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }} onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }} className="characters-mobile-filter-dialog"><div className="flex h-full flex-col"><div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3"><h2 className="font-interface text-xs font-bold uppercase tracking-[0.08em]">Filter characters</h2><button type="button" onClick={() => dialogRef.current?.close()} aria-label="Close filters" className="archive-focus grid h-9 w-9 place-items-center rounded-lg text-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">×</button></div><div className="min-h-0 flex-1 overflow-y-auto p-4"><FilterPanel filters={filters} options={options} total={total} initialTagSearch={initialTagSearch} onChange={onChange} onTagToggle={onTagToggle} onClear={onClear} idPrefix="mobile" /></div><div className="grid grid-cols-2 gap-2 border-t border-zinc-800 p-4"><button type="button" onClick={onClear} className="archive-button-secondary archive-focus">Clear</button><button type="button" onClick={() => dialogRef.current?.close()} className="archive-button-primary archive-focus">Close</button></div></div></dialog>;
}

function CharacterPagination({ browse, filters }: { browse: CharacterBrowseResult; filters: CharacterBrowseInput }) {
  const { pagination } = browse;
  if (pagination.totalPages <= 1 && pagination.page <= 1) return null;
  return <nav aria-label="Character pages" className="characters-pagination"><div>{pagination.hasPrevious && <Link href={characterBrowseHref(filters, { page: pagination.page - 1 }, { preservePage: true })} className="archive-focus">‹ Previous</Link>}</div><p>Page {pagination.page}{pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}</p><div>{pagination.hasNext && <Link href={characterBrowseHref(filters, { page: pagination.page + 1 }, { preservePage: true })} className="archive-focus">Next ›</Link>}</div></nav>;
}

function CharacterNoResults({ browse, filters, onClear }: { browse: CharacterBrowseResult; filters: CharacterBrowseInput; onClear: () => void }) {
  const beyond = browse.pagination.totalItems > 0 && browse.pagination.totalPages > 0 && browse.pagination.page > browse.pagination.totalPages;
  return <div className="characters-no-results"><div><p>{beyond ? "Page unavailable" : "No characters found"}</p><h2>{beyond ? "This page is outside the available results" : "Try removing a filter or changing your search."}</h2>{beyond ? <Link href={characterBrowseHref(filters, { page: 1 }, { preservePage: true })} className="archive-button-secondary archive-focus mt-4">Go to first page</Link> : <button type="button" onClick={onClear} className="archive-button-secondary archive-focus mt-4">Clear filters</button>}</div></div>;
}

function pageRange(browse: CharacterBrowseResult): string {
  if (browse.items.length === 0) return "0";
  const start = (browse.pagination.page - 1) * browse.pagination.pageSize + 1;
  return `${start}–${start + browse.items.length - 1}`;
}

function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function characterSelectionContextKey(filters: CharacterBrowseInput): string {
  return [filters.query, filters.sources.join(","), filters.tags.join(","), filters.tagSource, filters.statuses.join(","), filters.sort, filters.page].join("|");
}
