import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { AuthorCharacterLibrary } from "@/components/author-character-library";
import { SourceBadge } from "@/components/character-badges";
import { parseCharacterBrowseParams, type BrowseSearchParams } from "@/src/lib/archive/browse-params";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getAuthorCharacterFacets, getAuthorSummary } from "@/src/lib/authors/browse";
import { parseAuthorIdentity } from "@/src/lib/authors/params";
import { browseCharacters } from "@/src/lib/characters/browse";

export default async function AuthorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ platform: string; creatorId: string }>;
  searchParams: Promise<BrowseSearchParams>;
}) {
  await connection();
  await requireOwnerPageSession();
  const route = await params;
  const authorIdentity = parseAuthorIdentity(route.platform, route.creatorId);
  if (!authorIdentity) notFound();

  const author = await getAuthorSummary(authorIdentity);
  if (!author) notFound();

  const parsed = parseCharacterBrowseParams(await searchParams);
  const filters = { ...parsed, sources: [], author: authorIdentity };
  const [browse, facets] = await Promise.all([
    browseCharacters(filters),
    getAuthorCharacterFacets(authorIdentity),
  ]);

  return (
    <div>
      <Link href="/authors" className="archive-link archive-focus inline-flex rounded px-1 py-1 text-xs font-semibold">← All authors</Link>
      <header className="mt-3 flex flex-col justify-between gap-4 border-b border-zinc-800/80 pb-5 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><SourceBadge platform={author.platform} /><span className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">Source-scoped author</span></div>
          <h1 className="mt-3 break-words text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">{author.creatorName ?? "Unnamed creator"}</h1>
          <p className="mt-1.5 text-sm text-zinc-500">Characters are matched by source platform and exact external creator ID.</p>
        </div>
        <div className="archive-panel min-w-28 px-3.5 py-2.5">
          <p className="text-lg font-semibold tabular-nums text-zinc-100">{facets.total}</p>
          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">{facets.total === 1 ? "Character" : "Characters"}</p>
        </div>
      </header>
      <AuthorCharacterLibrary author={authorIdentity} browse={browse} facets={facets} filters={filters} />
    </div>
  );
}
