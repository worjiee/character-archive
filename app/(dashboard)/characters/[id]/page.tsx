import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CharacterAvatar } from "@/components/character-avatar";
import { CharacterManagementPanel } from "@/components/character-management-panel";
import { SourceBadge, StatusBadge } from "@/components/character-badges";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getCharacterById } from "@/src/lib/characters/repository";

export default async function CharacterDetailPage({ params }: PageProps<"/characters/[id]">) {
  await connection();
  await requireOwnerPageSession();
  const { id } = await params;
  const character = await getCharacterById(id);
  if (!character) notFound();
  const visibleGreetings = character.greetings.filter((greeting) => !greeting.hidden);
  return (
    <div>
      <Link href="/characters" className="text-sm text-zinc-400 hover:text-violet-300">← Back to characters</Link>
      <div className="mt-6 grid gap-7 lg:grid-cols-[260px_1fr]">
        <aside><CharacterAvatar name={character.name} src={character.avatarUrl} className="aspect-[3/4] w-full rounded-2xl" /><div className="mt-4 flex flex-wrap gap-2"><StatusBadge status={character.status} />{character.sources.map((source) => <SourceBadge key={`${source.platform}-${source.sourceUrl}`} platform={source.platform} />)}</div>{character.blockedReason && <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">{character.blockedReason}</p>}</aside>
        <main className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Character</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">{character.name}</h1><p className="mt-2 text-sm text-zinc-500">Updated {character.updatedAt.toLocaleString()}</p>
          <TextSection title="Description" value={character.description} /><TextSection title="Personality" value={character.personality} /><TextSection title="Scenario" value={character.scenario} />
          <DetailSection title={`Greetings (${visibleGreetings.length})`}>{visibleGreetings.length > 0 ? <ol className="space-y-3">{visibleGreetings.map((greeting, index) => <li key={greeting.id} className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-4 text-sm leading-6 text-zinc-300"><span className="mr-2 text-xs font-semibold text-violet-400">{index + 1}</span>{greeting.content}</li>)}</ol> : <EmptyValue />}</DetailSection>
          <DetailSection title="Tags">{character.tags.length > 0 ? <div className="flex flex-wrap gap-2">{character.tags.map((tag) => <span key={tag.slug} className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">{tag.name}</span>)}</div> : <EmptyValue />}</DetailSection>
          <DetailSection title="Sources"><div className="space-y-3">{character.sources.map((source) => <div key={`${source.platform}-${source.sourceUrl}`} className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-4"><div className="flex flex-wrap items-center gap-2"><SourceBadge platform={source.platform} /><span className="text-sm text-zinc-400">{source.creatorName ?? "Unknown creator"}</span></div><a href={source.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block break-all text-xs text-violet-400 hover:text-violet-300">{source.sourceUrl}</a></div>)}</div></DetailSection>
          <DetailSection title={`Lorebooks (${character.lorebooks.length})`}>{character.lorebooks.length > 0 ? <div className="space-y-3">{character.lorebooks.map((lorebook) => (
            <details key={lorebook.id} className="group rounded-xl border border-zinc-800 bg-zinc-950/45">
              <summary className="cursor-pointer list-none p-4 marker:hidden">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><SourceBadge platform={lorebook.sourcePlatform} /><span className="text-sm font-semibold text-zinc-200">{lorebook.title}</span></div>{lorebook.description && <p className="mt-2 text-xs leading-5 text-zinc-500">{lorebook.description}</p>}</div><div className="flex items-center gap-3"><span className="text-xs text-zinc-500">{lorebook.entries.length} {lorebook.entries.length === 1 ? "entry" : "entries"}</span><span className="text-zinc-500 transition group-open:rotate-45">+</span></div></div>
              </summary>
              <div className="space-y-3 border-t border-zinc-800 p-4">
                {lorebook.entries.map((entry) => (
                  <article key={entry.id} className="rounded-lg border border-zinc-800 bg-zinc-900/55 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-sm font-medium text-zinc-200">{entry.comment ?? entry.category ?? `Entry ${entry.externalEntryId}`}</h3>{entry.comment && entry.category && <p className="mt-1 text-xs text-zinc-500">{entry.category}</p>}</div><div className="flex flex-wrap gap-1.5"><EntryState enabled={entry.enabled} label={entry.enabled ? "Enabled" : "Disabled"} /><EntryState enabled={entry.constant} label={entry.constant ? "Constant" : "Conditional"} /><span className="rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400">Order {entry.insertionOrder}</span></div></div>
                    <div className="mt-3 flex flex-wrap gap-1.5">{entry.keys.length > 0 ? entry.keys.map((key) => <code key={key} className="rounded bg-violet-500/10 px-2 py-1 text-[11px] text-violet-300">{key}</code>) : <span className="text-xs text-zinc-600">No activation keys</span>}</div>
                    <details className="mt-3 rounded-lg bg-zinc-950/60"><summary className="cursor-pointer px-3 py-2 text-xs font-medium text-zinc-400 hover:text-zinc-200">Show content</summary><p className="whitespace-pre-wrap border-t border-zinc-800 px-3 py-3 text-sm leading-6 text-zinc-300">{entry.content}</p></details>
                  </article>
                ))}
                {lorebook.entries.length === 0 && <p className="text-sm text-zinc-600">This lorebook currently has no imported entries.</p>}
              </div>
            </details>
          ))}</div> : <EmptyValue />}</DetailSection>
          {character.status !== "DELETED" && <CharacterManagementPanel character={character} />}
        </main>
      </div>
    </div>
  );
}

function TextSection({ title, value }: { title: string; value: string | null }) { return <DetailSection title={title}>{value ? <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-300">{value}</p> : <EmptyValue />}</DetailSection>; }
function DetailSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="mt-8"><h2 className="mb-3 text-sm font-semibold text-zinc-100">{title}</h2>{children}</section>; }
function EmptyValue() { return <p className="text-sm text-zinc-600">Not provided.</p>; }
function EntryState({ enabled, label }: { enabled: boolean; label: string }) { return <span className={`rounded px-2 py-1 text-[10px] ${enabled ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-500"}`}>{label}</span>; }
