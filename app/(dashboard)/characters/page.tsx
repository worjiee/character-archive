import Link from "next/link";
import { connection } from "next/server";
import { CharacterLibrary } from "@/components/character-library";
import { requireUserPageSession } from "@/src/lib/auth";
import { parseCharacterBrowseParams, type BrowseSearchParams } from "@/src/lib/archive/browse-params";
import { browseCharacters, getCharacterBrowseFacets } from "@/src/lib/characters/browse";
import { getSelectedCatalogTags, searchCatalogTags } from "@/src/lib/tags/search";
import {
  isDevelopmentFixtureEnabled,
  LIVE_IMPORT_UNAVAILABLE_MESSAGE,
} from "@/src/lib/importers/development/availability";

export default async function CharactersPage({ searchParams }: { searchParams: Promise<BrowseSearchParams> }) {
  await connection();
  const principal = await requireUserPageSession();
  const filters = parseCharacterBrowseParams(await searchParams);
  const [browse, facets, tagSearch, selectedTags] = await Promise.all([
    browseCharacters(filters, principal),
    getCharacterBrowseFacets(principal),
    searchCatalogTags({ query: "", source: filters.tagSource, page: 1, limit: 50 }),
    getSelectedCatalogTags(filters.tags),
  ]);
  const emptyStateDescription = isDevelopmentFixtureEnabled()
    ? "Preview the development fixture and save it to create your first character."
    : `There are no characters in this repository yet. ${LIVE_IMPORT_UNAVAILABLE_MESSAGE}`;
  return (
    <div className="characters-page-shell">
      <div className="characters-page-header flex flex-col justify-between gap-3 border-b border-zinc-800/80 sm:flex-row sm:items-end">
        <div><p className="archive-eyebrow characters-page-eyebrow">Private archive</p><h1 className="characters-page-title font-semibold tracking-[-0.025em] text-zinc-50">Characters</h1><p className="characters-page-subtitle max-w-2xl text-zinc-500">Search, filter, select, and inspect normalized character records.</p></div>
        <Link href="/import" className="archive-button-secondary archive-focus characters-add-button shrink-0">＋ Add character</Link>
      </div>
      {facets.total === 0 ? (
        <section className="archive-panel mt-5 grid min-h-80 place-items-center border-dashed px-6 py-14 text-center"><div><div className="accent-muted mx-auto grid h-12 w-12 place-items-center rounded-xl border text-xl">◇</div><h2 className="mt-4 text-sm font-medium text-zinc-200">Your repository is empty</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">{emptyStateDescription}</p><Link href="/import" className="archive-button-secondary archive-focus mt-5">Open Import</Link></div></section>
      ) : (
        <CharacterLibrary browse={browse} facets={facets} filters={filters} initialTagSearch={tagSearch} selectedTags={selectedTags} />
      )}
    </div>
  );
}
