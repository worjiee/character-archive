"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { AuthorCharacterBrowseInput, AuthorCharacterSort } from "../src/lib/authors/browse";
import type { AuthorTagSearchItem, AuthorTagSearchResult } from "../src/lib/authors/contracts";
import type { AuthorIdentity } from "../src/lib/authors/identity";
import { authorCharacterBrowseHref, authorTagApiHref } from "../src/lib/authors/params";
import type { CharacterBrowseResult } from "../src/lib/characters/browse";
import { CharacterCardGrid } from "./character-card-grid";

export function AuthorCharacterLibrary({
  author,
  browse,
  filters,
  initialTags,
  selectedTags,
}: {
  author: AuthorIdentity;
  browse: CharacterBrowseResult;
  filters: AuthorCharacterBrowseInput;
  initialTags: AuthorTagSearchResult;
  selectedTags: Array<{ slug: string; label: string }>;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(patch: Partial<AuthorCharacterBrowseInput>, options: { replace?: boolean; preservePage?: boolean } = {}) {
    const href = authorCharacterBrowseHref(author, filters, patch, { preservePage: options.preservePage });
    startTransition(() => options.replace ? router.replace(href, { scroll: false }) : router.push(href, { scroll: false }));
  }

  function toggleTag(slug: string) {
    navigate({ tags: filters.tags.includes(slug) ? filters.tags.filter((value) => value !== slug) : [...filters.tags, slug] });
  }

  return (
    <section className="mt-6" aria-labelledby="author-characters-heading" aria-busy={isPending}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="archive-eyebrow">Character archive</p><h2 id="author-characters-heading" className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">All characters</h2></div>
        <p className="text-xs tabular-nums text-zinc-500">{pageRange(browse)} of {browse.pagination.totalItems}</p>
      </div>

      <div className="archive-panel mt-3 p-3 sm:p-3.5">
        <div className="grid gap-2.5 md:grid-cols-[minmax(14rem,1fr)_13rem]">
          <CharacterSearchInput key={filters.query} author={author} filters={filters} />
          <label><span className="sr-only">Sort this author&apos;s characters</span><select value={filters.sort} onChange={(event) => navigate({ sort: event.target.value as AuthorCharacterSort })} className="archive-input py-2 text-xs"><option value="published-newest">Newest published</option><option value="published-oldest">Oldest published</option><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option></select></label>
        </div>

        <AuthorTagBrowser author={author} initial={initialTags} selected={filters.tags} onToggle={toggleTag} />

        {filters.tags.length > 0 && (
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-600">Matches any selected tag</span>
              {filters.tags.map((slug) => {
                const label = selectedTags.find((tag) => tag.slug === slug)?.label ?? slug;
                return <button key={slug} type="button" onClick={() => toggleTag(slug)} className="archive-chip archive-focus" data-selected="true" aria-label={`Remove ${label} tag filter`}>{label} ×</button>;
              })}
              <button type="button" onClick={() => navigate({ tags: [] })} className="archive-focus ml-auto rounded-md px-2 py-1 text-[11px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">Clear tags</button>
            </div>
          </div>
        )}
      </div>

      {browse.items.length > 0 ? (
        <CharacterCardGrid selectable characters={browse.items} className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,10.5rem),1fr))] gap-3 sm:gap-3.5" />
      ) : (
        <CharacterNoResults author={author} browse={browse} filters={filters} onClear={() => navigate({ query: "", tags: [] })} />
      )}
      <CharacterPagination author={author} browse={browse} filters={filters} />
    </section>
  );
}

function AuthorTagBrowser({ author, initial, selected, onToggle }: { author: AuthorIdentity; initial: AuthorTagSearchResult; selected: readonly string[]; onToggle: (slug: string) => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const displayedResult = query ? result : initial;
  const grouped = useMemo(() => groupTags(displayedResult.items), [displayedResult.items]);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(authorTagApiHref(author, { query, page: 1, limit: initial.limit }), { signal: controller.signal });
        if (response.ok) setResult(await response.json() as AuthorTagSearchResult);
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [author, initial, query]);

  async function showMore() {
    setLoading(true);
    try {
      const response = await fetch(authorTagApiHref(author, { query, page: displayedResult.page + 1, limit: displayedResult.limit }));
      if (!response.ok) return;
      const next = await response.json() as AuthorTagSearchResult;
      setResult({ ...next, items: [...displayedResult.items, ...next.items] });
    } finally { setLoading(false); }
  }

  return (
    <details className="group mt-3 border-t border-zinc-800 pt-3" open>
      <summary className="archive-focus flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-1 text-xs font-semibold text-zinc-400 marker:hidden hover:text-zinc-100">Browse this creator&apos;s source tags{selected.length > 0 && <span className="accent-muted rounded-full border px-1.5 py-0.5 text-[10px]">{selected.length}</span>}<span aria-hidden="true" className="ml-auto transition group-open:rotate-180">⌄</span></summary>
      <div className="mt-3 border-t border-zinc-800 pt-3">
        <label className="relative block"><span className="sr-only">Search this creator&apos;s tags</span><input value={query} onChange={(event) => setQuery(event.target.value)} className="archive-input" placeholder="Search this creator’s tags" /></label>
        <div className="mt-3 max-h-56 overflow-y-auto pr-1" aria-busy={loading}>
          {grouped.map(([group, tags]) => <section key={group} aria-labelledby={`author-tag-${group}`} className="mb-3"><h3 id={`author-tag-${group}`} className="mb-1.5 text-[10px] font-bold text-zinc-600">{group}</h3><div className="flex flex-wrap gap-1.5">{tags.map((tag) => <TagButton key={tag.tagId} tag={tag} selected={selected.includes(tag.slug)} onToggle={onToggle} />)}</div></section>)}
          {!loading && displayedResult.items.length === 0 && <p className="py-5 text-center text-xs text-zinc-500">No source tags found. Try another search.</p>}
        </div>
        <div className="mt-2 flex items-center justify-between"><p className="text-[10px] tabular-nums text-zinc-600">{displayedResult.items.length} of {displayedResult.total} source tags</p>{displayedResult.hasMore && <button type="button" disabled={loading} onClick={() => void showMore()} className="archive-button-secondary archive-focus">{loading ? "Loading…" : "Show more"}</button>}</div>
      </div>
    </details>
  );
}

function TagButton({ tag, selected, onToggle }: { tag: AuthorTagSearchItem; selected: boolean; onToggle: (slug: string) => void }) {
  return <button type="button" aria-pressed={selected} aria-label={`${tag.displayLabel}, ${tag.count} characters`} onClick={() => onToggle(tag.slug)} className="archive-chip archive-focus" data-selected={selected ? "true" : undefined}>{tag.displayLabel}<span className="text-[9px] tabular-nums opacity-65">{tag.count}</span></button>;
}

function CharacterSearchInput({ author, filters }: { author: AuthorIdentity; filters: AuthorCharacterBrowseInput }) {
  const router = useRouter();
  const [draft, setDraft] = useState(filters.query);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (draft === filters.query) return;
    const timeout = window.setTimeout(() => startTransition(() => router.replace(authorCharacterBrowseHref(author, filters, { query: draft }), { scroll: false })), 300);
    return () => window.clearTimeout(timeout);
  }, [author, draft, filters, router]);
  return <label className="relative min-w-0" aria-busy={pending}><span className="sr-only">Search this author&apos;s characters</span><input value={draft} onChange={(event) => setDraft(event.target.value)} className="archive-input" placeholder="Search this creator’s characters" /></label>;
}

function CharacterPagination({ author, browse, filters }: { author: AuthorIdentity; browse: CharacterBrowseResult; filters: AuthorCharacterBrowseInput }) {
  const { pagination } = browse;
  if (pagination.totalPages <= 1 && pagination.page <= 1) return null;
  return <nav aria-label="Author character pages" className="mt-5 flex items-center justify-between gap-3"><div>{pagination.hasPrevious && <Link href={authorCharacterBrowseHref(author, filters, { page: pagination.page - 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">← Previous</Link>}</div><p className="text-xs tabular-nums text-zinc-500">Page {pagination.page}{pagination.totalPages > 0 ? ` of ${pagination.totalPages}` : ""}</p><div>{pagination.hasNext && <Link href={authorCharacterBrowseHref(author, filters, { page: pagination.page + 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">Next →</Link>}</div></nav>;
}

function CharacterNoResults({ author, browse, filters, onClear }: { author: AuthorIdentity; browse: CharacterBrowseResult; filters: AuthorCharacterBrowseInput; onClear: () => void }) {
  const beyond = browse.pagination.totalItems > 0 && browse.pagination.totalPages > 0 && browse.pagination.page > browse.pagination.totalPages;
  return <div className="archive-panel mt-3 grid min-h-64 place-items-center border-dashed px-6 py-12 text-center"><div><p className="archive-eyebrow">{beyond ? "Page unavailable" : "No matches"}</p><h2 className="mt-2 text-base font-semibold text-zinc-200">{beyond ? "This page is outside the available results" : "No published characters match these filters"}</h2><p className="mt-2 text-sm text-zinc-500">{beyond ? "Return to the first page to continue browsing." : "Try another search or remove a tag filter."}</p>{beyond ? <Link href={authorCharacterBrowseHref(author, filters, { page: 1 }, { preservePage: true })} className="archive-button-secondary archive-focus mt-5">Go to first page</Link> : <button type="button" onClick={onClear} className="archive-button-secondary archive-focus mt-5">Clear filters</button>}</div></div>;
}

function groupTags(items: AuthorTagSearchItem[]): Array<[string, AuthorTagSearchItem[]]> {
  const groups = new Map<string, AuthorTagSearchItem[]>();
  for (const item of items) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  return [...groups.entries()];
}

function pageRange(browse: CharacterBrowseResult): string {
  if (browse.items.length === 0) return "0";
  const start = (browse.pagination.page - 1) * browse.pagination.pageSize + 1;
  return `${start}–${start + browse.items.length - 1}`;
}
