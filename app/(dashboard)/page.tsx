import Link from "next/link";
import { connection } from "next/server";
import { CharacterCardGrid } from "@/components/character-card-grid";
import { HomeSourceOverview } from "@/components/home-source-overview";
import { LorebookLibraryCard } from "@/components/lorebook-library-card";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getHomeArchiveData } from "@/src/lib/home/archive";

export default async function HomePage() {
  await connection();
  await requireOwnerPageSession();
  const { characters, characterFacets, lorebooks } = await getHomeArchiveData();

  return (
    <div>
      <header className="flex flex-col justify-between gap-4 border-b border-zinc-800/80 pb-5 sm:flex-row sm:items-end">
        <div>
          <p className="archive-eyebrow">Private repository</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">Character Archive</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">A source-aware overview of the characters and lorebooks in your private archive.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <ArchiveCount label="Characters" value={characterFacets.total} />
          <ArchiveCount label="Lorebooks" value={lorebooks.pagination.totalItems} />
        </div>
      </header>

      <section className="mt-5" aria-labelledby="source-overview-heading">
        <SectionHeading
          eyebrow="Browse by provenance"
          title="Source overview"
          id="source-overview-heading"
        />
        <div className="mt-3">
          <HomeSourceOverview total={characterFacets.total} sources={characterFacets.sources} />
        </div>
      </section>

      <section className="mt-7" aria-labelledby="recent-characters-heading">
        <SectionHeading
          eyebrow="All persisted sources"
          title="Recently updated characters"
          id="recent-characters-heading"
          href="/characters"
          linkLabel="View all characters"
        />
        {characters.items.length > 0 ? (
          <CharacterCardGrid
            characters={characters.items}
            className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-3 sm:gap-3.5"
          />
        ) : (
          <HomeEmptyState
            title="No characters yet"
            description="Imported character records will appear here across every supported source."
            href="/import"
            action="Open Import"
          />
        )}
      </section>

      <section className="mt-7" aria-labelledby="recent-lorebooks-heading">
        <SectionHeading
          eyebrow="World information"
          title="Recently updated lorebooks"
          id="recent-lorebooks-heading"
          href="/lorebooks"
          linkLabel="View all lorebooks"
        />
        {lorebooks.items.length > 0 ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {lorebooks.items.map((lorebook) => <LorebookLibraryCard key={lorebook.id} lorebook={lorebook} />)}
          </div>
        ) : (
          <HomeEmptyState
            title="No lorebooks yet"
            description="Imported lorebook references and their normalized entries will appear here."
            href="/lorebooks"
            action="Open lorebook library"
          />
        )}
      </section>
    </div>
  );
}

function ArchiveCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="archive-panel min-w-28 px-3.5 py-2.5">
      <p className="text-lg font-semibold tabular-nums text-zinc-100">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">{label}</p>
    </div>
  );
}

function SectionHeading({
  eyebrow,
  title,
  id,
  href,
  linkLabel,
}: {
  eyebrow: string;
  title: string;
  id: string;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="archive-eyebrow">{eyebrow}</p>
        <h2 id={id} className="mt-1 text-base font-semibold text-zinc-100">{title}</h2>
      </div>
      {href && linkLabel && <Link href={href} className="archive-link archive-focus shrink-0 rounded px-1.5 py-1 text-xs font-semibold">{linkLabel} <span aria-hidden="true">→</span></Link>}
    </div>
  );
}

function HomeEmptyState({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <div className="archive-panel mt-3 border-dashed px-5 py-8 text-center">
      <h3 className="text-sm font-medium text-zinc-300">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-zinc-500">{description}</p>
      <Link href={href} className="archive-button-secondary archive-focus mt-4">{action}</Link>
    </div>
  );
}
