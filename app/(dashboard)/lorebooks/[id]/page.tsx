import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CharacterAvatar } from "@/components/character-avatar";
import { SourceBadge, StatusBadge } from "@/components/character-badges";
import { SourceLinkActions } from "@/components/source-link-actions";
import { requireUserPageSession } from "@/src/lib/auth";
import { getLorebookById, type LorebookDetail } from "@/src/lib/lorebooks/repository";

export default async function LorebookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const principal = await requireUserPageSession();
  const { id } = await params;
  const lorebook = await getLorebookById(id, principal);
  if (!lorebook) notFound();

  return (
    <div className="mx-auto max-w-[82rem]">
      <Link href="/lorebooks" className="archive-link archive-focus inline-flex items-center gap-2 rounded-md text-xs font-medium"><span aria-hidden="true">←</span>Lorebooks</Link>

      <header className="mt-4 border-b border-zinc-800/80 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-4xl">
            <div className="flex flex-wrap items-center gap-2"><SourceBadge platform={lorebook.sourcePlatform} variant="compact" /><span className="archive-eyebrow">Lorebook record</span></div>
            <h1 className="mt-3 break-words text-3xl font-semibold leading-tight tracking-[-0.035em] text-zinc-50 sm:text-[2.2rem]">{lorebook.title}</h1>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">{lorebook.description ?? "No summary has been provided for this lorebook."}</p>
          </div>
          <dl className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
            <Metric value={lorebook.entryCount} label={lorebook.entryCount === 1 ? "Entry" : "Entries"} />
            <Metric value={lorebook.characterCount} label={lorebook.characterCount === 1 ? "Character" : "Characters"} />
          </dl>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600">
          <span>Updated {formatDate(lorebook.updatedAt)}</span>
          <span>Added {formatDate(lorebook.createdAt)}</span>
          {lorebook.lastSyncedAt && <span>Synced {formatDate(lorebook.lastSyncedAt)}</span>}
        </div>
        <SourceLinkActions sourceUrl={lorebook.sourceUrl} />
      </header>

      <section className="mt-6" aria-labelledby="lorebook-entries-heading">
        <div className="mb-2.5"><p className="archive-eyebrow">Normalized source content</p><h2 id="lorebook-entries-heading" className="mt-1 text-base font-semibold text-zinc-100">Entries · {lorebook.entries.length}</h2></div>
        {lorebook.entries.length > 0 ? (
          <ol className="space-y-2">{lorebook.entries.map((entry, index) => <LorebookEntryCard key={entry.id} entry={entry} index={index} />)}</ol>
        ) : (
          <div className="archive-panel border-dashed px-6 py-10 text-center text-sm text-zinc-500">This lorebook currently has no imported entries.</div>
        )}
      </section>

      <section className="mt-7 border-t border-zinc-800/80 pt-6" aria-labelledby="used-by-heading">
        <p className="archive-eyebrow">Repository relationships</p>
        <h2 id="used-by-heading" className="mt-1 text-base font-semibold text-zinc-100">Used by · {lorebook.characters.length} {lorebook.characters.length === 1 ? "character" : "characters"}</h2>
        {lorebook.characters.length > 0 ? (
          <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3">
            {lorebook.characters.map((character) => <AttachedCharacterCard key={character.id} character={character} />)}
          </div>
        ) : (
          <div className="archive-panel mt-3 border-dashed px-6 py-10 text-center text-sm text-zinc-500">No characters are attached to this lorebook.</div>
        )}
      </section>
    </div>
  );
}

function LorebookEntryCard({ entry, index }: { entry: LorebookDetail["entries"][number]; index: number }) {
  const title = entry.comment ?? entry.category ?? `Entry ${entry.externalEntryId}`;
  return (
    <li>
      <details className="archive-panel group overflow-hidden">
        <summary className="archive-focus cursor-pointer list-none rounded-xl p-3 marker:hidden sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 items-start gap-3">
                <span className="shrink-0 font-mono text-xs font-semibold text-violet-400">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0"><h3 className="line-clamp-2 break-words text-xs font-semibold text-zinc-200">{title}</h3>{entry.comment && entry.category && <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">{entry.category}</p>}</div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 sm:ml-9">
                {entry.keys.length > 0 ? entry.keys.map((key) => <code key={key} className="accent-muted max-w-full break-all rounded border px-1.5 py-0.5 text-[10px]">{key}</code>) : <span className="text-[10px] text-zinc-600">No activation keys</span>}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <EntryState active={entry.enabled} activeLabel="Enabled" inactiveLabel="Disabled" />
              <EntryState active={entry.constant} activeLabel="Constant" inactiveLabel="Conditional" />
              <span className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-zinc-500">Order {entry.insertionOrder}</span>
            </div>
          </div>
          <p className="mt-3 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-500 group-open:hidden">{entry.content}</p>
          <span className="mt-2 inline-block text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-600 group-open:hidden">Expand entry</span>
        </summary>
        <div className="border-t border-zinc-800 px-4 py-4 sm:px-6">
          <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">{entry.content}</p>
          <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-zinc-800 pt-3 text-[10px] text-zinc-500">
            {entry.activationMode && <div><dt className="inline font-semibold text-zinc-400">Activation mode: </dt><dd className="inline break-all">{entry.activationMode}</dd></div>}
            {entry.caseSensitive !== null && <div><dt className="inline font-semibold text-zinc-400">Key matching: </dt><dd className="inline">{entry.caseSensitive ? "Case sensitive" : "Case insensitive"}</dd></div>}
            {entry.groupWeight !== null && <div><dt className="inline font-semibold text-zinc-400">Group weight: </dt><dd className="inline tabular-nums">{entry.groupWeight}</dd></div>}
          </dl>
        </div>
      </details>
    </li>
  );
}

function AttachedCharacterCard({ character }: { character: LorebookDetail["characters"][number] }) {
  const creators = [...new Set(character.sources.map(({ creatorName }) => creatorName).filter((value): value is string => Boolean(value)))];
  return (
    <Link href={`/characters/${encodeURIComponent(character.id)}`} className="archive-panel archive-focus group flex min-w-0 items-center gap-3 rounded-xl p-3 transition hover:border-[var(--accent-border)] hover:bg-zinc-900/45">
      <CharacterAvatar name={character.name} src={character.avatarUrl} className="h-16 w-12 rounded-lg" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-zinc-200 group-hover:text-violet-300">{character.name}</h3>
        <p className="mt-1 truncate text-[10px] text-zinc-500">by {creators.length > 0 ? creators.join(", ") : "Unknown creator"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1"><StatusBadge status={character.status} />{character.sources.map((source) => <SourceBadge key={`${source.platform}-${source.sourceUrl}`} platform={source.platform} variant="compact" />)}</div>
      </div>
      <span aria-hidden="true" className="shrink-0 text-zinc-700 group-hover:text-violet-400">→</span>
    </Link>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="archive-panel min-w-28 px-3 py-2"><dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-600">{label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-zinc-200">{value}</dd></div>;
}

function EntryState({ active, activeLabel, inactiveLabel }: { active: boolean; activeLabel: string; inactiveLabel: string }) {
  return <span className={`rounded px-2 py-1 text-[9px] ${active ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>{active ? activeLabel : inactiveLabel}</span>;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(value);
}
