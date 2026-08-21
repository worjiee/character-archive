"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type {
  AuthorBrowseInput,
  AuthorBrowseResult,
  AuthorBrowseSort,
} from "../src/lib/authors/browse";
import {
  authorDetailHref,
  authorsBrowseHref,
} from "../src/lib/authors/params";
import { SourceBadge } from "./character-badges";

export function AuthorLibrary({
  browse,
  filters,
}: {
  browse: AuthorBrowseResult;
  filters: AuthorBrowseInput;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function navigate(
    patch: Partial<AuthorBrowseInput>,
    options: { replace?: boolean; preservePage?: boolean } = {},
  ) {
    const href = authorsBrowseHref(filters, patch, { preservePage: options.preservePage });
    startTransition(() => options.replace
      ? router.replace(href, { scroll: false })
      : router.push(href, { scroll: false }));
  }

  return (
    <section className="mt-5" aria-labelledby="author-results-heading" aria-busy={isPending}>
      <h2 id="author-results-heading" className="sr-only">Author results</h2>
      <div className="archive-panel p-3 sm:p-3.5">
        <div className="grid gap-2.5 md:grid-cols-[minmax(14rem,1fr)_13rem]">
          <AuthorSearchInput key={filters.query} filters={filters} />
          <label>
            <span className="sr-only">Sort authors</span>
            <select
              value={filters.sort}
              onChange={(event) => navigate({ sort: event.target.value as AuthorBrowseSort })}
              className="archive-input py-2 text-xs"
            >
              <option value="name-asc">Name A–Z</option>
              <option value="name-desc">Name Z–A</option>
              <option value="characters-desc">Most characters</option>
              <option value="recent">Recent archive activity</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex min-h-7 items-center gap-3 border-t border-zinc-800 pt-3">
          <p className="text-[11px] text-zinc-500">Source-scoped creator identities with stable external IDs</p>
          {filters.query && (
            <button
              type="button"
              onClick={() => navigate({ query: "" })}
              className="archive-focus ml-auto rounded-md px-2 py-1 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              Clear search
            </button>
          )}
        </div>
      </div>

      {browse.items.length > 0 ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {browse.items.map((author) => (
            <Link
              key={`${author.platform}-${author.externalCreatorId}`}
              href={authorDetailHref(author)}
              className="archive-panel archive-focus group flex min-w-0 flex-col p-4 transition hover:border-[var(--accent-border)] hover:bg-zinc-900/55 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <SourceBadge platform={author.platform} />
                <span aria-hidden="true" className="text-lg text-zinc-700 transition group-hover:translate-x-0.5 group-hover:text-violet-400">→</span>
              </div>
              <h3 className="mt-4 truncate text-sm font-semibold text-zinc-100 transition group-hover:text-violet-300">
                {author.creatorName ?? "Unnamed creator"}
              </h3>
              <p className="mt-1 truncate text-[10px] text-zinc-600">Source identity · {author.externalCreatorId}</p>
              <div className="mt-4 flex items-end justify-between gap-3 border-t border-zinc-800 pt-3">
                <p className="text-xs text-zinc-500"><strong className="font-semibold tabular-nums text-zinc-300">{author.characterCount}</strong> {author.characterCount === 1 ? "character" : "characters"}</p>
                {author.latestArchiveActivityAt && <p className="text-right text-[9px] uppercase tracking-[0.1em] text-zinc-600">Synced {formatDate(author.latestArchiveActivityAt)}</p>}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <AuthorEmptyState filters={filters} />
      )}

      <AuthorPagination browse={browse} filters={filters} />
    </section>
  );
}

function AuthorSearchInput({ filters }: { filters: AuthorBrowseInput }) {
  const router = useRouter();
  const [draft, setDraft] = useState(filters.query);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (draft === filters.query) return;
    const timeout = window.setTimeout(() => {
      startTransition(() => router.replace(authorsBrowseHref(filters, { query: draft }), { scroll: false }));
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [draft, filters, router]);

  return (
    <label className="relative min-w-0" aria-busy={pending}>
      <span className="sr-only">Search authors by creator name</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} className="archive-input pl-9" placeholder="Search creator name" />
    </label>
  );
}

function AuthorPagination({ browse, filters }: { browse: AuthorBrowseResult; filters: AuthorBrowseInput }) {
  if (!browse.pagination.hasPrevious && !browse.pagination.hasNext) return null;
  return (
    <nav aria-label="Author pages" className="mt-5 flex items-center justify-between gap-3">
      <div>{browse.pagination.hasPrevious && <Link href={authorsBrowseHref(filters, { page: filters.page - 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">← Previous</Link>}</div>
      <p className="text-xs tabular-nums text-zinc-500">Page {browse.pagination.page}</p>
      <div>{browse.pagination.hasNext && <Link href={authorsBrowseHref(filters, { page: filters.page + 1 }, { preservePage: true })} className="archive-button-secondary archive-focus">Next →</Link>}</div>
    </nav>
  );
}

function AuthorEmptyState({ filters }: { filters: AuthorBrowseInput }) {
  const invalidPage = filters.page > 1;
  const searched = Boolean(filters.query);
  return (
    <div className="archive-panel mt-3 grid min-h-64 place-items-center border-dashed px-6 py-12 text-center">
      <div>
        <p className="archive-eyebrow">{invalidPage ? "Page unavailable" : searched ? "No matches" : "No authors"}</p>
        <h2 className="mt-2 text-base font-semibold text-zinc-200">
          {invalidPage ? "This page is outside the available author results" : searched ? "No authors match this creator name" : "No source-scoped authors are available"}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
          {invalidPage ? "Return to the first page to continue browsing." : searched ? "Try another name or clear the search." : "Authors appear after a source record provides a stable external creator ID."}
        </p>
        {(invalidPage || searched) && <Link href="/authors" className="archive-button-secondary archive-focus mt-5">{invalidPage ? "Go to first page" : "Clear search"}</Link>}
      </div>
    </div>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}
