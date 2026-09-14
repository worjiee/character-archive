"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { characterBrowseHref } from "../src/lib/archive/browse-params";
import { parseCreatorParam } from "../src/lib/authors/params";
import type {
  CharacterBrowseAuthorScope,
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
import { CharacterQuickViewHost } from "./character-quick-view-host";

import {
  activeCharacterFilterCount,
  buildCharacterSourceNavigation,
  showModalWhenClosed,
  type CharacterLibraryFilterOptions,
} from "./character-library-utils";

export interface UserCollectionSummary {
  id: string;
  name: string;
  characterCount: number;
}

export function CharacterLibrary({
  browse,
  facets,
  filters,
  initialTagSearch,
  selectedTags,
  userCollections = [],
}: {
  browse: CharacterBrowseResult;
  facets: CharacterBrowseFacets;
  filters: CharacterBrowseInput;
  initialTagSearch: TagSearchResult;
  selectedTags: SelectedTagOption[];
  userCollections?: UserCollectionSummary[];
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
  const [surpriseQuickViewId, setSurpriseQuickViewId] = useState<string | null>(null);
  const [surpriseLoading, setSurpriseLoading] = useState(false);
  const [lastSurpriseId, setLastSurpriseId] = useState<string | null>(null);
  const [surpriseFeedback, setSurpriseFeedback] = useState<string | null>(null);
  const surpriseInFlightRef = useRef(false);
  const surpriseButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleSurpriseMe = useCallback(async () => {
    if (surpriseInFlightRef.current || browse.pagination.totalItems === 0) return;
    surpriseInFlightRef.current = true;
    setSurpriseLoading(true);
    setSurpriseFeedback(null);

    try {
      const href = characterBrowseHref(filters, {});
      const queryIndex = href.indexOf("?");
      const queryString = queryIndex >= 0 ? href.slice(queryIndex + 1) : "";
      const params = new URLSearchParams(queryString);
      if (lastSurpriseId) {
        params.set("excludeId", lastSurpriseId);
      }
      const query = params.toString();
      const url = `/api/characters/random${query ? `?${query}` : ""}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        setSurpriseFeedback("Could not select a character. Please try again.");
        return;
      }

      const data = (await response.json()) as { characterId: string | null; totalCandidates: number };
      if (!data.characterId) {
        setSurpriseFeedback("No characters match the current filters.");
        return;
      }

      setLastSurpriseId(data.characterId);
      setSurpriseQuickViewId(data.characterId);
    } catch {
      setSurpriseFeedback("Could not select a character. Please try again.");
    } finally {
      surpriseInFlightRef.current = false;
      setSurpriseLoading(false);
    }
  }, [browse.pagination.totalItems, filters, lastSurpriseId]);


  function navigate(patch: Partial<CharacterBrowseInput>, options: { replace?: boolean; preservePage?: boolean } = {}) {
    setMobileFiltersOpen(false);
    const href = characterBrowseHref(filters, patch, { preservePage: options.preservePage });
    startTransition(() => options.replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }));
  }

  function clearFilters() {
    navigate({
      query: "",
      sources: [],
      tags: [],
      statuses: [],
      creator: undefined,
      author: undefined,
      tokenMin: undefined,
      tokenMax: undefined,
      minGreetings: undefined,
      hasArtwork: undefined,
      hasLorebook: undefined,
      hasScenario: undefined,
      hasAltGreetings: undefined,
      inFavorites: undefined,
      inCart: undefined,
      collectionId: undefined,
    });
  }

  function toggleTag(item: TagSearchItem) {
    setInteractionTagLabels((current) => ({ ...current, [item.slug]: item.displayLabel }));
    navigate({ tags: toggleValue(filters.tags, item.slug) });
  }

  useEffect(() => {
    if (browse.pagination.totalPages === 0 && filters.page > 1) {
      const href = characterBrowseHref(filters, { page: 1 }, { preservePage: true });
      router.replace(href, { scroll: false });
    } else if (browse.pagination.totalPages > 0 && filters.page > browse.pagination.totalPages) {
      const href = characterBrowseHref(filters, { page: browse.pagination.totalPages }, { preservePage: true });
      router.replace(href, { scroll: false });
    }
  }, [browse.pagination.totalPages, filters, router]);

  function handleBulkDeleteSuccess() {
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="characters-browser" aria-busy={isPending}>
      <div className="characters-browser-layout">
        <aside className="characters-filter-rail" aria-label="Character filters">
          <FilterPanel
            filters={filters}
            options={options}
            total={facets.total}
            initialTagSearch={initialTagSearch}
            userCollections={userCollections}
            onChange={(patch) => navigate(patch)}
            onTagToggle={toggleTag}
            onClear={clearFilters}
            idPrefix="desktop"
          />
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
              >
                Filter{activeCount > 0 && <span>{activeCount}</span>}
              </button>
              <span className="archive-toolbar-label hidden text-zinc-500 sm:inline">Filter</span>
              <ActiveFilterChips
                filters={filters}
                options={options}
                selectedTagLabels={selectedTagLabels}
                userCollections={userCollections}
                onChange={(patch) => navigate(patch)}
              />
              {activeCount > 0 && (
                <button type="button" onClick={clearFilters} className="characters-clear-filters archive-focus">
                  Clear all
                </button>
              )}
            </div>
            <div className="characters-toolbar-actions">
              <button
                ref={surpriseButtonRef}
                type="button"
                onClick={handleSurpriseMe}
                disabled={browse.pagination.totalItems === 0 || surpriseLoading}
                className="characters-surprise-me-button archive-focus"
                aria-label="Surprise me"
                aria-busy={surpriseLoading}
                title={browse.pagination.totalItems === 0 ? "No characters match current filters" : "Pick a random character matching current filters"}
              >
                <span aria-hidden="true">🎲</span>
                <span className="characters-surprise-me-label">Surprise me</span>
                {surpriseLoading && <span className="characters-button-spinner" aria-hidden="true" />}
              </button>
              <label className="characters-sort-field">
                <span className="archive-toolbar-label text-zinc-500">Sort</span>
                <select
                  value={filters.sort}
                  onChange={(event) => navigate({ sort: event.target.value as CharacterBrowseSort })}
                  className="archive-input archive-sort-control characters-sort-control"
                >
                  <option value="updated">Freshest activity</option>
                  <option value="updated-oldest">Oldest activity</option>
                  <option value="newest">Newest added</option>
                  <option value="oldest">Oldest added</option>
                  <option value="name-asc">Name A–Z</option>
                  <option value="name-desc">Name Z–A</option>
                  <option value="tokens-asc">Lowest tokens</option>
                  <option value="tokens-desc">Highest tokens</option>
                  <option value="greetings-desc">Most greetings</option>
                </select>
              </label>
            </div>
          </div>

          {surpriseFeedback && (
            <p className="characters-surprise-feedback" role="status">
              {surpriseFeedback}
            </p>
          )}

          <div className="characters-result-meta">
            <span>{pageRange(browse)} of {browse.pagination.totalItems} characters</span>
            <span>Page selection only</span>
          </div>

          {browse.items.length > 0 ? (
            <CharacterCardGrid
              key={selectionContext}
              characters={browse.items}
              selectable
              enableBulkDelete
              onBulkDeleteSuccess={handleBulkDeleteSuccess}
            />
          ) : (
            <CharacterNoResults browse={browse} filters={filters} onClear={clearFilters} />
          )}
          <CharacterPagination browse={browse} filters={filters} />
        </section>

        {mobileFiltersOpen && (
          <MobileFilterDialog
            filters={filters}
            options={options}
            total={facets.total}
            initialTagSearch={initialTagSearch}
            userCollections={userCollections}
            onChange={(patch) => navigate(patch)}
            onTagToggle={toggleTag}
            onClear={clearFilters}
            onClose={() => setMobileFiltersOpen(false)}
          />
        )}

        {surpriseQuickViewId && (
          <CharacterQuickViewHost
            characterId={surpriseQuickViewId}
            navigationItems={browse.items.map(({ id, name }) => ({ id, name }))}
            onNavigate={setSurpriseQuickViewId}
            onClose={() => {
              setSurpriseQuickViewId(null);
              surpriseButtonRef.current?.focus();
            }}
          />
        )}
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
  return (
    <label className="characters-search-field" aria-busy={pending}>
      <span className="sr-only">Search characters or creators</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="archive-input"
        placeholder="Search characters or creators"
      />
    </label>
  );
}

function FilterPanel({
  filters,
  options,
  total,
  initialTagSearch,
  userCollections,
  onChange,
  onTagToggle,
  onClear,
  idPrefix,
}: {
  filters: CharacterBrowseInput;
  options: CharacterLibraryFilterOptions;
  total: number;
  initialTagSearch: TagSearchResult;
  userCollections: UserCollectionSummary[];
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
  onTagToggle: (item: TagSearchItem) => void;
  onClear: () => void;
  idPrefix: string;
}) {
  const activeCount = activeCharacterFilterCount(filters);
  const creatorActive = Boolean(filters.creator || filters.author);
  const tokensActive = filters.tokenMin !== undefined || filters.tokenMax !== undefined;
  const greetingsActive = filters.minGreetings !== undefined && filters.minGreetings > 0;
  const contentActive = typeof filters.hasArtwork === "boolean" || typeof filters.hasLorebook === "boolean" || typeof filters.hasScenario === "boolean" || typeof filters.hasAltGreetings === "boolean";
  const libraryActive = Boolean(filters.inFavorites || filters.inCart || filters.collectionId);
  const statusActive = filters.statuses.length > 0;

  return (
    <div>
      <div className="characters-filter-heading">
        <div>
          <p>Filter by</p>
          <h2>Characters</h2>
        </div>
        {activeCount > 0 && <button type="button" onClick={onClear} className="archive-focus">Reset</button>}
      </div>

      <details open className="characters-filter-group">
        <summary className="characters-filter-summary-title">Sources</summary>
        <SourceFilterGroup total={total} facets={options.platforms} selected={filters.sources} onChange={(sources) => onChange({ sources })} />
      </details>

      <details open className="characters-filter-group">
        <summary className="characters-filter-summary-title">Tags</summary>
        <TagFilterGroup
          key={`${idPrefix}-${filters.tagSource}`}
          initialResult={initialTagSearch}
          source={filters.tagSource}
          selected={filters.tags}
          idPrefix={`${idPrefix}-tag`}
          onSourceChange={(tagSource) => onChange({ tagSource })}
          onToggle={onTagToggle}
        />
      </details>

      <details open={creatorActive} className="characters-filter-group">
        <summary className="characters-filter-summary-title">Creator</summary>
        <CreatorFilterGroup
          creator={filters.creator}
          author={filters.author}
          idPrefix={`${idPrefix}-creator`}
          onChange={onChange}
        />
      </details>

      <details open={tokensActive} className="characters-filter-group">
        <summary className="characters-filter-summary-title">Token Count</summary>
        <TokenRangeFilterGroup
          tokenMin={filters.tokenMin}
          tokenMax={filters.tokenMax}
          idPrefix={`${idPrefix}-tokens`}
          onChange={onChange}
        />
      </details>

      <details open={greetingsActive} className="characters-filter-group">
        <summary className="characters-filter-summary-title">Greetings</summary>
        <GreetingFilterGroup
          minGreetings={filters.minGreetings}
          idPrefix={`${idPrefix}-greetings`}
          onChange={onChange}
        />
      </details>

      <details open={contentActive} className="characters-filter-group">
        <summary className="characters-filter-summary-title">Content</summary>
        <ContentPresenceFilterGroup
          hasArtwork={filters.hasArtwork}
          hasLorebook={filters.hasLorebook}
          hasScenario={filters.hasScenario}
          hasAltGreetings={filters.hasAltGreetings}
          idPrefix={`${idPrefix}-content`}
          onChange={onChange}
        />
      </details>

      <details open={libraryActive} className="characters-filter-group">
        <summary className="characters-filter-summary-title">My Library</summary>
        <MyLibraryFilterGroup
          inFavorites={filters.inFavorites}
          inCart={filters.inCart}
          collectionId={filters.collectionId}
          userCollections={userCollections}
          idPrefix={`${idPrefix}-library`}
          onChange={onChange}
        />
      </details>

      {options.statuses.length > 0 && (
        <details open={statusActive} className="characters-filter-group">
          <summary className="characters-filter-summary-title">Status</summary>
          <FilterGroup
            title=""
            values={options.statuses}
            selected={filters.statuses}
            idPrefix={`${idPrefix}-status`}
            onToggle={(value) => onChange({ statuses: toggleValue(filters.statuses, value) as CharacterBrowseInput["statuses"] })}
          />
        </details>
      )}
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
    <div className="characters-source-options">
      {requested.map((item) => {
        const isAll = item.key === "ALL";
        const pressed = isAll ? selected.length === 0 : selected.includes(item.key as PersistedSourcePlatform);
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={pressed}
            disabled={item.disabled}
            title={item.disabled ? "Coming soon" : undefined}
            onClick={() => {
              if (isAll) onChange([]);
              else if (!item.disabled) onChange(toggleValue(selected, item.key) as PersistedSourcePlatform[]);
            }}
            className="archive-focus"
          >
            <span className="flex min-w-0 items-center gap-2">
              {!isAll && <SourceBadge platform={item.key} variant="compact" />}
              <span className="truncate">{item.label}</span>
            </span>
            <span>{item.count ?? "Soon"}</span>
          </button>
        );
      })}
      {other && (
        <button
          type="button"
          aria-pressed={selected.includes("OTHER")}
          onClick={() => onChange(toggleValue(selected, "OTHER") as PersistedSourcePlatform[])}
          className="archive-focus"
        >
          <span className="flex items-center gap-2">
            <SourceBadge platform="OTHER" variant="compact" />Other
          </span>
          <span>{other.count}</span>
        </button>
      )}
    </div>
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
  const tagListRef = useRef<HTMLDivElement | null>(null);
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
      if (currentRequest === requestId.current) {
        setResult(next);
        tagListRef.current?.scrollTo({ top: 0 });
      }
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
    <div>
      <label className="characters-tag-search">
        <span className="sr-only">Search all tags</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            if (!nextQuery.trim()) {
              requestController.current?.abort();
              requestId.current += 1;
              setResult(initialResult);
              setLoading(false);
              setError(null);
              tagListRef.current?.scrollTo({ top: 0 });
            }
          }}
          placeholder="Search all tags..."
          aria-label="Search all tags"
        />
      </label>
      <TagSourceControl source={source} onChange={onSourceChange} />
      <p className="characters-filter-hint">Matches any selected tag</p>
      <div ref={tagListRef} className="characters-tag-result-region" aria-busy={loading}>
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
          <div className="characters-tag-empty">
            <strong>No tags found</strong>
            <span>Try another search or source vocabulary.</span>
          </div>
        )}
        {loading && <p className="characters-tag-status" role="status">Searching tags…</p>}
        {error && <p className="characters-tag-status" role="alert">{error}</p>}
      </div>
      <div className="characters-tag-pagination" aria-label="Tag result pages">
        <button type="button" disabled={loading || result.page <= 1} onClick={() => void loadPage(result.page - 1, query)} className="archive-focus">
          Previous
        </button>
        <span>{result.total === 0 ? "0 tags" : `Page ${result.page} · ${result.total} tags`}</span>
        <button type="button" disabled={loading || !result.hasMore} onClick={() => void loadPage(result.page + 1, query)} className="archive-focus">
          Show more
        </button>
      </div>
    </div>
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
          >
            {choice.label}
          </button>
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

interface CreatorAutocompleteResult {
  key: string;
  name: string;
  platform: PersistedSourcePlatform;
  characterCount: number;
  identity: { platform: PersistedSourcePlatform; kind: "EXTERNAL_ID" | "CREATOR_NAME"; value: string };
}

function CreatorFilterGroup({
  creator,
  author,
  idPrefix,
  onChange,
}: {
  creator?: string;
  author?: CharacterBrowseAuthorScope;
  idPrefix: string;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CreatorAutocompleteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const activeIdentity = author ?? (creator ? parseCreatorParam(creator) : null);
  const creatorDisplay = activeIdentity
    ? ("value" in activeIdentity ? activeIdentity.value : (activeIdentity as { externalCreatorId?: string }).externalCreatorId ?? creator)
    : creator;

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/creators?q=${encodeURIComponent(trimmed)}&limit=10`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (response.ok) {
          const data = await response.json() as { items: CreatorAutocompleteResult[] };
          setResults(data.items ?? []);
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          // ignore
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  return (
    <div className="mt-2 space-y-2">
      {activeIdentity ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/80 px-2.5 py-1.5 text-xs">
          <div className="flex min-w-0 items-center gap-2">
            <SourceBadge platform={activeIdentity.platform} variant="compact" />
            <span className="truncate font-medium text-zinc-200">{creatorDisplay}</span>
          </div>
          <button
            type="button"
            onClick={() => onChange({ creator: undefined, author: undefined })}
            className="archive-focus -mr-1 rounded p-1 text-zinc-400 hover:text-zinc-100"
            title="Clear creator"
            aria-label="Clear creator"
          >
            ×
          </button>
        </div>
      ) : (
        <div>
          <label htmlFor={`${idPrefix}-input`} className="sr-only">Search creators</label>
          <input
            id={`${idPrefix}-input`}
            type="search"
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              setQuery(val);
              if (!val.trim()) {
                setResults([]);
                setLoading(false);
              }
            }}
            placeholder="Search creators..."
            className="archive-input text-xs w-full"
            autoComplete="off"
          />
          {loading && <p className="mt-1 text-[0.7rem] text-zinc-500">Searching creators…</p>}
          {results.length > 0 && (
            <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950 p-1 space-y-0.5">
              {results.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    onChange({ creator: item.key, author: item.identity });
                    setQuery("");
                    setResults([]);
                  }}
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-800/80 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <SourceBadge platform={item.platform} variant="compact" />
                    <span className="truncate text-zinc-200">{item.name}</span>
                  </div>
                  <span className="text-zinc-500 tabular-nums shrink-0 text-[0.7rem]">{item.characterCount} chars</span>
                </button>
              ))}
            </div>
          )}
          {!loading && query.trim() && results.length === 0 && (
            <p className="mt-1 text-[0.7rem] text-zinc-500">No creators found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function TokenRangeFilterGroup({
  tokenMin,
  tokenMax,
  idPrefix,
  onChange,
}: {
  tokenMin?: number;
  tokenMax?: number;
  idPrefix: string;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  const [draftMin, setDraftMin] = useState(tokenMin !== undefined ? String(tokenMin) : "");
  const [draftMax, setDraftMax] = useState(tokenMax !== undefined ? String(tokenMax) : "");
  const [prevTokens, setPrevTokens] = useState({ min: tokenMin, max: tokenMax });

  if (prevTokens.min !== tokenMin || prevTokens.max !== tokenMax) {
    setPrevTokens({ min: tokenMin, max: tokenMax });
    setDraftMin(tokenMin !== undefined ? String(tokenMin) : "");
    setDraftMax(tokenMax !== undefined ? String(tokenMax) : "");
  }

  function handleApply() {
    const minVal = draftMin.trim() ? Number(draftMin.trim()) : undefined;
    const maxVal = draftMax.trim() ? Number(draftMax.trim()) : undefined;
    const validMin = minVal !== undefined && Number.isSafeInteger(minVal) && minVal >= 0 && minVal <= 2000000 ? minVal : undefined;
    const validMax = maxVal !== undefined && Number.isSafeInteger(maxVal) && maxVal >= 0 && maxVal <= 2000000 ? maxVal : undefined;
    if (validMin !== undefined && validMax !== undefined && validMin > validMax) {
      return;
    }
    onChange({ tokenMin: validMin, tokenMax: validMax });
  }

  const isApplied = tokenMin !== undefined || tokenMax !== undefined;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-1.5">
        <div className="flex-1 min-w-0">
          <label htmlFor={`${idPrefix}-min`} className="sr-only">Min tokens</label>
          <input
            id={`${idPrefix}-min`}
            type="number"
            min={0}
            max={2000000}
            placeholder="Min"
            value={draftMin}
            onChange={(e) => setDraftMin(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
            className="archive-input text-xs w-full"
          />
        </div>
        <span className="text-zinc-500 text-xs shrink-0">–</span>
        <div className="flex-1 min-w-0">
          <label htmlFor={`${idPrefix}-max`} className="sr-only">Max tokens</label>
          <input
            id={`${idPrefix}-max`}
            type="number"
            min={0}
            max={2000000}
            placeholder="Max"
            value={draftMax}
            onChange={(e) => setDraftMax(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleApply(); }}
            className="archive-input text-xs w-full"
          />
        </div>
        <button
          type="button"
          onClick={handleApply}
          className="archive-button-secondary archive-focus text-xs py-1 px-2 shrink-0"
        >
          Apply
        </button>
      </div>
      {isApplied && (
        <button
          type="button"
          onClick={() => {
            setDraftMin("");
            setDraftMax("");
            onChange({ tokenMin: undefined, tokenMax: undefined });
          }}
          className="text-[0.7rem] text-zinc-400 hover:text-zinc-200"
        >
          Clear token range
        </button>
      )}
    </div>
  );
}

function GreetingFilterGroup({
  minGreetings,
  idPrefix,
  onChange,
}: {
  minGreetings?: number;
  idPrefix: string;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  const presets = [
    { label: "Any", value: undefined },
    { label: "1+", value: 1 },
    { label: "2+", value: 2 },
    { label: "3+", value: 3 },
    { label: "5+", value: 5 },
  ];

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => {
          const active = (preset.value === undefined && (minGreetings === undefined || minGreetings === 0)) ||
            (preset.value !== undefined && minGreetings === preset.value);
          return (
            <button
              key={`${idPrefix}-${preset.label}`}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ minGreetings: preset.value })}
              className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors archive-focus ${
                active
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-200"
              }`}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <p className="characters-filter-hint">Characters with at least N non-hidden greetings</p>
    </div>
  );
}

function ContentPresenceFilterGroup({
  hasArtwork,
  hasLorebook,
  hasScenario,
  hasAltGreetings,
  idPrefix,
  onChange,
}: {
  hasArtwork?: boolean;
  hasLorebook?: boolean;
  hasScenario?: boolean;
  hasAltGreetings?: boolean;
  idPrefix: string;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  const items: Array<{
    key: "hasArtwork" | "hasLorebook" | "hasScenario" | "hasAltGreetings";
    label: string;
    value: boolean | undefined;
  }> = [
    { key: "hasArtwork", label: "Artwork", value: hasArtwork },
    { key: "hasLorebook", label: "Lorebook", value: hasLorebook },
    { key: "hasScenario", label: "Scenario", value: hasScenario },
    { key: "hasAltGreetings", label: "Alt Greetings", value: hasAltGreetings },
  ];

  return (
    <div className="mt-2 space-y-2">
      {items.map((item) => (
        <div key={item.key} className="flex items-center justify-between gap-2 text-xs">
          <span id={`${idPrefix}-${item.key}-label`} className="text-zinc-300 truncate font-medium">{item.label}</span>
          <div className="characters-segmented-control shrink-0" role="group" aria-labelledby={`${idPrefix}-${item.key}-label`}>
            <button
              type="button"
              aria-pressed={item.value === undefined}
              onClick={() => onChange({ [item.key]: undefined })}
              className="characters-segmented-btn archive-focus"
            >
              Any
            </button>
            <button
              type="button"
              aria-pressed={item.value === true}
              onClick={() => onChange({ [item.key]: true })}
              className="characters-segmented-btn archive-focus"
            >
              Yes
            </button>
            <button
              type="button"
              aria-pressed={item.value === false}
              onClick={() => onChange({ [item.key]: false })}
              className="characters-segmented-btn archive-focus"
            >
              No
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function MyLibraryFilterGroup({
  inFavorites,
  inCart,
  collectionId,
  userCollections,
  idPrefix,
  onChange,
}: {
  inFavorites?: boolean;
  inCart?: boolean;
  collectionId?: string;
  userCollections: UserCollectionSummary[];
  idPrefix: string;
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  return (
    <div className="mt-2 space-y-2.5">
      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-favorites`} className="characters-filter-option">
          <input
            id={`${idPrefix}-favorites`}
            type="checkbox"
            checked={Boolean(inFavorites)}
            onChange={(e) => onChange({ inFavorites: e.target.checked ? true : undefined })}
          />
          <span className="min-w-0 flex-1">In Favorites</span>
        </label>
        <label htmlFor={`${idPrefix}-cart`} className="characters-filter-option">
          <input
            id={`${idPrefix}-cart`}
            type="checkbox"
            checked={Boolean(inCart)}
            onChange={(e) => onChange({ inCart: e.target.checked ? true : undefined })}
          />
          <span className="min-w-0 flex-1">In Cart</span>
        </label>
      </div>
      {userCollections.length > 0 && (
        <div>
          <label htmlFor={`${idPrefix}-collection`} className="block text-[0.7rem] font-medium text-zinc-400 mb-1">
            Custom Collection
          </label>
          <select
            id={`${idPrefix}-collection`}
            value={collectionId ?? ""}
            onChange={(e) => onChange({ collectionId: e.target.value || undefined })}
            className="archive-input text-xs w-full"
          >
            <option value="">All / None</option>
            {userCollections.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name} ({col.characterCount})
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function groupTagResults(items: TagSearchItem[]): Array<[string, TagSearchItem[]]> {
  const groups = new Map<string, TagSearchItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups.entries()];
}

function FilterGroup({ values, selected, idPrefix, onToggle }: {
  title?: string;
  values: Array<{ value: string; label: string; count: number }>;
  selected: readonly string[];
  idPrefix: string;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="characters-filter-options">
      {values.map((option) => (
        <FilterOption
          key={option.value}
          option={option}
          checked={selected.includes(option.value)}
          id={`${idPrefix}-${option.value}`}
          onToggle={() => onToggle(option.value)}
        />
      ))}
    </div>
  );
}

function FilterOption({ option, checked, id, onToggle }: { option: { value: string; label: string; count: number }; checked: boolean; id: string; onToggle: () => void }) {
  return (
    <label htmlFor={id} className="characters-filter-option">
      <input id={id} type="checkbox" checked={checked} onChange={onToggle} />
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      <span>{option.count}</span>
    </label>
  );
}

function ActiveFilterChips({
  filters,
  options,
  selectedTagLabels,
  userCollections,
  onChange,
}: {
  filters: CharacterBrowseInput;
  options: CharacterLibraryFilterOptions;
  selectedTagLabels: Record<string, string>;
  userCollections: UserCollectionSummary[];
  onChange: (patch: Partial<CharacterBrowseInput>) => void;
}) {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = [];

  // Sources
  for (const source of filters.sources) {
    const label = options.platforms.find((p) => p.value === source)?.label ?? source;
    chips.push({
      key: `source-${source}`,
      label,
      onRemove: () => onChange({ sources: filters.sources.filter((s) => s !== source) }),
    });
  }

  // Tags
  for (const tag of filters.tags) {
    const label = selectedTagLabels[tag] ?? tag;
    chips.push({
      key: `tag-${tag}`,
      label,
      onRemove: () => onChange({ tags: filters.tags.filter((t) => t !== tag) }),
    });
  }

  // Creator
  if (filters.creator || filters.author) {
    const activeIdentity = filters.author ?? (filters.creator ? parseCreatorParam(filters.creator) : null);
    const name = activeIdentity
      ? ("value" in activeIdentity ? activeIdentity.value : (activeIdentity as { externalCreatorId?: string }).externalCreatorId ?? filters.creator)
      : filters.creator;
    chips.push({
      key: "creator",
      label: `Creator: ${name}`,
      onRemove: () => onChange({ creator: undefined, author: undefined }),
    });
  }

  // Token range
  if (filters.tokenMin !== undefined && filters.tokenMax !== undefined) {
    chips.push({
      key: "tokens",
      label: `${filters.tokenMin.toLocaleString()}–${filters.tokenMax.toLocaleString()} tokens`,
      onRemove: () => onChange({ tokenMin: undefined, tokenMax: undefined }),
    });
  } else if (filters.tokenMin !== undefined) {
    chips.push({
      key: "tokens",
      label: `≥ ${filters.tokenMin.toLocaleString()} tokens`,
      onRemove: () => onChange({ tokenMin: undefined, tokenMax: undefined }),
    });
  } else if (filters.tokenMax !== undefined) {
    chips.push({
      key: "tokens",
      label: `≤ ${filters.tokenMax.toLocaleString()} tokens`,
      onRemove: () => onChange({ tokenMin: undefined, tokenMax: undefined }),
    });
  }

  // Greetings
  if (filters.minGreetings !== undefined && filters.minGreetings > 0) {
    chips.push({
      key: "greetings",
      label: `≥ ${filters.minGreetings} ${filters.minGreetings === 1 ? "greeting" : "greetings"}`,
      onRemove: () => onChange({ minGreetings: undefined }),
    });
  }

  // Content presence
  if (typeof filters.hasArtwork === "boolean") {
    chips.push({
      key: "artwork",
      label: `Artwork: ${filters.hasArtwork ? "Yes" : "No"}`,
      onRemove: () => onChange({ hasArtwork: undefined }),
    });
  }
  if (typeof filters.hasLorebook === "boolean") {
    chips.push({
      key: "lorebook",
      label: `Lorebook: ${filters.hasLorebook ? "Yes" : "No"}`,
      onRemove: () => onChange({ hasLorebook: undefined }),
    });
  }
  if (typeof filters.hasScenario === "boolean") {
    chips.push({
      key: "scenario",
      label: `Scenario: ${filters.hasScenario ? "Yes" : "No"}`,
      onRemove: () => onChange({ hasScenario: undefined }),
    });
  }
  if (typeof filters.hasAltGreetings === "boolean") {
    chips.push({
      key: "altGreetings",
      label: `Alternate greetings: ${filters.hasAltGreetings ? "Yes" : "No"}`,
      onRemove: () => onChange({ hasAltGreetings: undefined }),
    });
  }

  // Library
  if (filters.inFavorites) {
    chips.push({
      key: "inFavorites",
      label: "In Favorites",
      onRemove: () => onChange({ inFavorites: undefined }),
    });
  }
  if (filters.inCart) {
    chips.push({
      key: "inCart",
      label: "In Cart",
      onRemove: () => onChange({ inCart: undefined }),
    });
  }
  if (filters.collectionId) {
    const colName = userCollections.find((c) => c.id === filters.collectionId)?.name ?? "Collection";
    chips.push({
      key: "collection",
      label: `Collection: ${colName}`,
      onRemove: () => onChange({ collectionId: undefined }),
    });
  }

  // Statuses
  for (const status of filters.statuses) {
    const label = options.statuses.find((s) => s.value === status)?.label ?? status;
    chips.push({
      key: `status-${status}`,
      label,
      onRemove: () => onChange({ statuses: filters.statuses.filter((s) => s !== status) }),
    });
  }

  return (
    <>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className="archive-chip archive-focus"
          data-selected="true"
        >
          {chip.label}
          <span aria-hidden="true">×</span>
          <span className="sr-only">Remove {chip.label} filter</span>
        </button>
      ))}
    </>
  );
}

function MobileFilterDialog({
  filters,
  options,
  total,
  initialTagSearch,
  userCollections,
  onChange,
  onTagToggle,
  onClear,
  onClose,
}: {
  filters: CharacterBrowseInput;
  options: CharacterLibraryFilterOptions;
  total: number;
  initialTagSearch: TagSearchResult;
  userCollections: UserCollectionSummary[];
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
  return (
    <dialog
      id="character-mobile-filters"
      ref={dialogRef}
      aria-label="Character filters"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); dialogRef.current?.close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) dialogRef.current?.close(); }}
      className="characters-mobile-filter-dialog"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="font-interface text-xs font-bold uppercase tracking-[0.08em]">Filter characters</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="Close filters"
            className="archive-focus grid h-9 w-9 place-items-center rounded-lg text-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <FilterPanel
            filters={filters}
            options={options}
            total={total}
            initialTagSearch={initialTagSearch}
            userCollections={userCollections}
            onChange={onChange}
            onTagToggle={onTagToggle}
            onClear={onClear}
            idPrefix="mobile"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-zinc-800 p-4">
          <button type="button" onClick={onClear} className="archive-button-secondary archive-focus">
            Clear
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()} className="archive-button-primary archive-focus">
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

function CharacterPagination({ browse, filters }: { browse: CharacterBrowseResult; filters: CharacterBrowseInput }) {
  const { pagination } = browse;
  if (pagination.totalPages <= 1 && pagination.page <= 1) return null;
  return (
    <nav aria-label="Character pages" className="characters-pagination">
      <div>
        {pagination.hasPrevious && (
          <Link href={characterBrowseHref(filters, { page: pagination.page - 1 }, { preservePage: true })} className="archive-focus">
            ‹ Previous
          </Link>
        )}
      </div>
      <p>Page {pagination.page}{pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}</p>
      <div>
        {pagination.hasNext && (
          <Link href={characterBrowseHref(filters, { page: pagination.page + 1 }, { preservePage: true })} className="archive-focus">
            Next ›
          </Link>
        )}
      </div>
    </nav>
  );
}

function CharacterNoResults({ browse, filters, onClear }: { browse: CharacterBrowseResult; filters: CharacterBrowseInput; onClear: () => void }) {
  const beyond = browse.pagination.totalItems > 0 && browse.pagination.totalPages > 0 && browse.pagination.page > browse.pagination.totalPages;
  return (
    <div className="characters-no-results">
      <div>
        <p>{beyond ? "Page unavailable" : "No characters match these filters."}</p>
        <h2>{beyond ? "This page is outside the available results" : "Try removing a filter or changing your search."}</h2>
        {beyond ? (
          <Link href={characterBrowseHref(filters, { page: 1 }, { preservePage: true })} className="archive-button-secondary archive-focus mt-4">
            Go to first page
          </Link>
        ) : (
          <button type="button" onClick={onClear} className="archive-button-secondary archive-focus mt-4">
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
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
  return [
    filters.query,
    filters.sources.join(","),
    filters.tags.join(","),
    filters.tagSource,
    filters.statuses.join(","),
    filters.sort,
    filters.page,
    filters.creator ?? "",
    filters.tokenMin ?? "",
    filters.tokenMax ?? "",
    filters.minGreetings ?? "",
    filters.hasArtwork ?? "",
    filters.hasLorebook ?? "",
    filters.hasScenario ?? "",
    filters.hasAltGreetings ?? "",
    filters.inFavorites ? "fav" : "",
    filters.inCart ? "cart" : "",
    filters.collectionId ?? "",
  ].join("|");
}
