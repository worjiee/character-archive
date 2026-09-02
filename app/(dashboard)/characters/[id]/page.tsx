import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CharacterAvatar } from "@/components/character-avatar";
import { SourceBadge, StatusBadge } from "@/components/character-badges";
import { CharacterManagementPanel } from "@/components/character-management-panel";
import { SourceLinkActions } from "@/components/source-link-actions";
import { requireUserPageSession } from "@/src/lib/auth";
import { getCharacterById, type CharacterDetail } from "@/src/lib/characters/repository";
import { getSourceIdentity } from "@/src/lib/sources/presentation";
import { lorebookDetailHref } from "@/components/lorebook-library-utils";

export default async function CharacterDetailPage({ params }: PageProps<"/characters/[id]">) {
  await connection();
  const principal = await requireUserPageSession();
  const { id } = await params;
  const character = await getCharacterById(id, principal);
  if (!character) notFound();
  const visibleGreetings = character.greetings.filter((greeting) => !greeting.hidden);
  const creators = [...new Set(character.sources.map((source) => source.creatorName).filter(Boolean))];

  return (
    <div className="mx-auto max-w-[82rem]">
      <Link href="/characters" className="archive-link archive-focus inline-flex items-center gap-2 rounded-md text-xs font-medium"><span aria-hidden="true">←</span>Characters</Link>

      <section className="mt-4 grid gap-5 border-b border-zinc-800/80 pb-6 md:grid-cols-[236px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="mx-auto w-full max-w-[260px] md:mx-0">
          <CharacterAvatar name={character.name} src={character.avatarUrl} className="aspect-[3/4] w-full rounded-xl shadow-2xl shadow-black/30" />
          <div className="mt-3 flex flex-wrap gap-1.5"><StatusBadge status={character.status} />{character.sources.map((source) => <SourceBadge key={`${source.platform}-${source.sourceUrl}`} platform={source.platform} />)}</div>
        </aside>
        <div className="min-w-0 self-end">
          <p className="archive-eyebrow">Character record</p>
          <h1 className="mt-1.5 break-words text-3xl font-semibold leading-tight tracking-[-0.035em] text-zinc-50 sm:text-[2.2rem]">{character.name}</h1>
          <p className="mt-2 text-sm text-zinc-500">by {creators.length > 0 ? creators.join(", ") : "Unknown creator"}</p>
          <div className="mt-4 flex flex-wrap gap-1.5">{character.tags.map((tag) => <span key={tag.slug} className="rounded-md border border-zinc-800 bg-zinc-900/65 px-2 py-1 text-[10px] text-zinc-400">{tag.name}</span>)}</div>
          <div className="mt-4 max-w-5xl border-l-2 border-[var(--accent-border)] pl-4">
            <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{character.description ?? "No description provided."}</p>
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.12em] text-zinc-600">Updated {formatUpdatedDate(character.updatedAt)}</p>
          <p className="mt-1 text-[10px] text-zinc-500">
            Added by {character.uploaderName}
            {character.publishedAt ? ` · First published ${formatUpdatedDate(character.publishedAt)}` : " · Not yet published"}
          </p>
          {character.blockedReason && <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{character.blockedReason}</p>}
        </div>
      </section>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
        <DefinitionCard title="Personality" value={character.personality} />
        <DefinitionCard title="Scenario" value={character.scenario} />
      </div>

      <DetailSection eyebrow="Dialog model" title="Example dialogs" className="max-w-6xl">
        {character.exampleDialogs ? <p className="max-w-4xl whitespace-pre-wrap text-sm leading-7 text-zinc-300">{character.exampleDialogs}</p> : <EmptyValue />}
      </DetailSection>

      <DetailSection eyebrow="Conversation openings" title={`Greetings · ${visibleGreetings.length}`} className="max-w-6xl">
        {visibleGreetings.length > 0 ? <ol className="space-y-2">{visibleGreetings.map((greeting, index) => <GreetingRow key={greeting.id} greeting={greeting} index={index} />)}</ol> : <EmptyValue />}
      </DetailSection>

      <DetailSection eyebrow="World information" title={`Lorebooks · ${character.lorebooks.length}`} className="max-w-6xl" contentClassName="p-3 sm:p-4">
        {character.lorebooks.length > 0 ? <LorebookList lorebooks={character.lorebooks} /> : <EmptyValue />}
      </DetailSection>

      <DetailSection eyebrow="Provenance" title={`Sources · ${character.sources.length}`} className="max-w-5xl" contentClassName="p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-2">{character.sources.map((source) => <article key={`${source.platform}-${source.sourceUrl}`} className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/35 p-3"><div className="flex flex-wrap items-center gap-2"><SourceBadge platform={source.platform} /><span className="min-w-0 truncate text-xs text-zinc-400">{source.creatorName ?? "Unknown creator"}</span></div><p className="mt-1 text-[10px] text-zinc-600">Source added by {source.addedBy}</p><a href={source.sourceUrl} target="_blank" rel="noreferrer" title={source.sourceUrl} aria-label={`Open source URL: ${source.sourceUrl}`} className="archive-focus mt-2 block min-w-0 truncate rounded-sm text-xs leading-5 text-violet-400 hover:text-violet-300">{source.sourceUrl}</a><SourceLinkActions sourceUrl={source.sourceUrl} /></article>)}</div>
      </DetailSection>

      {principal.role === "ADMIN" && character.status !== "DELETED" && <CharacterManagementPanel character={character} />}
    </div>
  );
}

function DefinitionCard({ title, value }: { title: string; value: string | null }) {
  return <section className="archive-panel p-4 sm:p-5"><h2 className="archive-eyebrow">{title}</h2>{value ? <p className="mt-2.5 whitespace-pre-wrap text-sm leading-7 text-zinc-300">{value}</p> : <div className="mt-3"><EmptyValue /></div>}</section>;
}

function DetailSection({ eyebrow, title, children, className = "", contentClassName = "p-4 sm:p-5" }: { eyebrow: string; title: string; children: React.ReactNode; className?: string; contentClassName?: string }) {
  return <section className={`mt-6 ${className}`}><div className="mb-2.5 flex flex-wrap items-end justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">{eyebrow}</p><h2 className="mt-1 text-base font-semibold text-zinc-100">{title}</h2></div></div><div className={`archive-panel ${contentClassName}`}>{children}</div></section>;
}

function GreetingRow({ greeting, index }: { greeting: CharacterDetail["greetings"][number]; index: number }) {
  return (
    <li>
      <details className="group rounded-lg border border-zinc-800 bg-zinc-950/45">
        <summary className="archive-focus grid cursor-pointer list-none grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-3 rounded-lg p-3 marker:hidden sm:p-4">
          <span className="font-mono text-xs font-semibold text-violet-400">{String(index + 1).padStart(2, "0")}</span>
          <span className="min-w-0"><span className="block text-xs font-medium text-zinc-300">{index === 0 ? "Default greeting" : "Alternative greeting"}</span><span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-xs leading-5 text-zinc-500 group-open:hidden">{greeting.content}</span><span className="mt-1 block text-[10px] text-zinc-600">{getSourceIdentity(greeting.source.platform).label}{greeting.source.creatorName ? ` · ${greeting.source.creatorName}` : ""}</span></span>
          <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500 group-open:text-violet-300"><span className="group-open:hidden">Expand</span><span className="hidden group-open:inline">Collapse</span></span>
        </summary>
        <p className="max-w-4xl whitespace-pre-wrap border-t border-zinc-800 px-4 py-4 text-sm leading-7 text-zinc-300 sm:pl-[4.75rem]">{greeting.content}</p>
      </details>
    </li>
  );
}

function LorebookList({ lorebooks }: { lorebooks: CharacterDetail["lorebooks"] }) {
  return <div className="space-y-3">{lorebooks.map((lorebook) => <article key={lorebook.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/45"><div className="p-3 sm:px-4"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SourceBadge platform={lorebook.sourcePlatform} /><Link href={lorebookDetailHref(lorebook.id)} className="archive-link archive-focus break-words rounded-sm text-sm font-semibold">{lorebook.title}</Link><span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">{lorebook.entries.length} {lorebook.entries.length === 1 ? "entry" : "entries"}</span></div>{shouldShowLorebookDescription(lorebook.description) && <p className="mt-2 line-clamp-2 max-w-3xl text-xs leading-5 text-zinc-500">{lorebook.description}</p>}</div><Link href={lorebookDetailHref(lorebook.id)} className="archive-focus shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-800 hover:text-violet-300">View lorebook →</Link></div></div><details className="group border-t border-zinc-800"><summary className="archive-focus flex cursor-pointer list-none items-center justify-between rounded-b-lg px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500 marker:hidden hover:bg-zinc-900/60 hover:text-zinc-300 sm:px-4"><span>Attached entries</span><span className="transition group-open:rotate-45">＋</span></summary><div className="grid gap-2 border-t border-zinc-800 p-3">{lorebook.entries.map((entry) => <LorebookEntry key={entry.id} entry={entry} />)}{lorebook.entries.length === 0 && <p className="py-4 text-center text-sm text-zinc-600">This lorebook currently has no imported entries.</p>}</div></details></article>)}</div>;
}

function LorebookEntry({ entry }: { entry: CharacterDetail["lorebooks"][number]["entries"][number] }) {
  return <details className="group/entry rounded-lg border border-zinc-800 bg-zinc-900/50"><summary className="archive-focus cursor-pointer list-none rounded-lg p-3 marker:hidden"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h3 className="break-words text-xs font-medium text-zinc-200">{entry.comment ?? entry.category ?? `Entry ${entry.externalEntryId}`}</h3>{entry.comment && entry.category && <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">{entry.category}</p>}<div className="mt-2 flex flex-wrap gap-1">{entry.keys.length > 0 ? entry.keys.map((key) => <code key={key} className="accent-muted rounded border px-1.5 py-0.5 text-[10px]">{key}</code>) : <span className="text-[10px] text-zinc-600">No activation keys</span>}</div></div><div className="flex shrink-0 flex-wrap gap-1"><EntryState enabled={entry.enabled} label={entry.enabled ? "Enabled" : "Disabled"} /><EntryState enabled={entry.constant} label={entry.constant ? "Constant" : "Conditional"} /><span className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-zinc-500">Order {entry.insertionOrder}</span></div></div><p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-zinc-500 group-open/entry:hidden">{entry.content}</p></summary><p className="max-w-4xl whitespace-pre-wrap border-t border-zinc-800 px-4 py-4 text-sm leading-7 text-zinc-300">{entry.content}</p></details>;
}

function EmptyValue() { return <p className="text-sm text-zinc-600">Not provided.</p>; }
function EntryState({ enabled, label }: { enabled: boolean; label: string }) { return <span className={`rounded px-2 py-1 text-[9px] ${enabled ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>{label}</span>; }
function formatUpdatedDate(value: Date): string { return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value); }
function shouldShowLorebookDescription(value: string | null): value is string { return value !== null && (process.env.NODE_ENV === "development" || !/\b(?:synthetic\s+)?development fixture\b/i.test(value)); }
