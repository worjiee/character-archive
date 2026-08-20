import { connection } from "next/server";
import { LorebookBrowseNavigation } from "@/components/lorebook-browse-navigation";
import { LorebookLibrary } from "@/components/lorebook-library";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { parseLorebookBrowseParams, type BrowseSearchParams } from "@/src/lib/archive/browse-params";
import { browseLorebooks, getLorebookBrowseFacets } from "@/src/lib/lorebooks/browse";

export default async function LorebooksPage({ searchParams }: { searchParams: Promise<BrowseSearchParams> }) {
  await connection();
  await requireOwnerPageSession();
  const filters = parseLorebookBrowseParams(await searchParams);
  const [browse, facets] = await Promise.all([
    browseLorebooks(filters),
    getLorebookBrowseFacets(),
  ]);

  return (
    <div>
      <div className="border-b border-zinc-800/80 pb-5">
        <p className="archive-eyebrow">World information library</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">Lorebooks</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">Browse imported lorebooks, their normalized entries, and the characters that use them.</p>
      </div>
      <div className="mt-5"><LorebookBrowseNavigation /></div>
      {facets.total > 0 ? (
        <LorebookLibrary browse={browse} facets={facets} filters={filters} />
      ) : (
        <section className="archive-panel mt-5 grid min-h-72 place-items-center border-dashed px-6 py-14 text-center">
          <div>
            <div className="accent-muted mx-auto grid h-12 w-12 place-items-center rounded-xl border text-xl" aria-hidden="true">▤</div>
            <h2 className="mt-4 text-sm font-medium text-zinc-200">No lorebooks in this repository</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">Lorebooks will appear here after they are imported and attached to repository records.</p>
          </div>
        </section>
      )}
    </div>
  );
}
