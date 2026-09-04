import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthorCharacterLibrary } from "@/components/author-character-library";
import { CharacterCardGrid } from "@/components/character-card-grid";
import { SourceBadge } from "@/components/character-badges";
import type { BrowseSearchParams } from "@/src/lib/archive/browse-params";
import { requireUserPageSession } from "@/src/lib/auth";
import {
  browseAuthorCharacters,
  getAuthorProfile,
  getAuthorRecentCharacters,
  getSelectedAuthorTags,
  searchAuthorTags,
} from "@/src/lib/authors/browse";
import { AUTHOR_TAG_DEFAULT_LIMIT } from "@/src/lib/authors/contracts";
import { parseAuthorCharacterBrowseParams, parseAuthorIdentity } from "@/src/lib/authors/params";

export default async function AuthorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string; creatorId: string }>;
  searchParams: Promise<BrowseSearchParams>;
}) {
  await connection();
  const principal = await requireUserPageSession();
  const route = await params;
  const identity = parseAuthorIdentity(route.platform, route.creatorId);
  if (!identity) notFound();

  const profile = await getAuthorProfile(identity, principal);
  if (!profile) notFound();
  const filters = parseAuthorCharacterBrowseParams(await searchParams);
  const [browse, recent, initialTags, selectedTags] = await Promise.all([
    browseAuthorCharacters(identity, filters, principal),
    getAuthorRecentCharacters(identity, principal),
    searchAuthorTags(identity, { query: "", page: 1, limit: AUTHOR_TAG_DEFAULT_LIMIT }, principal),
    getSelectedAuthorTags(identity, filters.tags, principal),
  ]);

  return (
    <div>
      <Link href="/authors" className="archive-link archive-focus inline-flex rounded px-1 py-1 text-xs font-semibold">← All authors</Link>
      <header className="mt-3 border-b border-zinc-800/80 pb-5">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><SourceBadge platform={profile.identity.platform} variant="compact" /><span className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">Source-scoped creator</span></div>
            <h1 className="mt-3 break-words text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.9rem]">{profile.creatorName}</h1>
            <p className="mt-1.5 max-w-xl text-sm text-zinc-500">A catalog profile built from this creator&apos;s active, published archive entries on this source.</p>
          </div>
          <div className="archive-panel min-w-32 px-4 py-3">
            <p className="text-xl font-semibold tabular-nums text-zinc-100">{profile.characterCount}</p>
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">Published {profile.characterCount === 1 ? "character" : "characters"}</p>
            <p className="mt-2 text-[10px] text-zinc-600">Latest {formatDate(profile.latestPublishedAt)}</p>
          </div>
        </div>
      </header>

      {recent.length > 0 && (
        <section className="mt-6" aria-labelledby="recent-author-characters">
          <div><p className="archive-eyebrow">Publication chronology</p><h2 id="recent-author-characters" className="mt-1 text-xl font-semibold tracking-tight text-zinc-100">Recent</h2></div>
          <CharacterCardGrid characters={recent} className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" />
        </section>
      )}

      <AuthorCharacterLibrary author={identity} browse={browse} filters={filters} initialTags={initialTags} selectedTags={selectedTags} />
    </div>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(value);
}
