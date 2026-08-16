import Link from "next/link";
import { connection } from "next/server";
import { CharacterAvatar } from "@/components/character-avatar";
import { SourceBadge, StatusBadge } from "@/components/character-badges";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { listCharacters } from "@/src/lib/characters/repository";

export default async function CharactersPage() {
  await connection();
  await requireOwnerPageSession();
  const characters = await listCharacters();
  return (
    <div>
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Repository</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">Characters</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Browse normalized characters and their source records, tags, greetings, and lorebooks.</p></div>
        <Link href="/import" className="accent-solid rounded-lg px-4 py-2.5 text-center text-sm font-semibold shadow-lg shadow-violet-950/40 transition hover:brightness-110">Import character</Link>
      </div>
      {characters.length === 0 ? (
        <section className="mt-8 grid min-h-72 place-items-center rounded-xl border border-zinc-800 bg-zinc-900/35 px-6 py-14 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-zinc-800 bg-zinc-900 text-xl text-zinc-500">◇</div><h2 className="mt-4 text-sm font-medium text-zinc-300">Your repository is empty</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">Preview the development fixture and save it to create your first character.</p><Link href="/import" className="mt-5 inline-flex rounded-lg border border-zinc-700 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Open Import</Link></div></section>
      ) : (
        <section aria-label={`${characters.length} characters`} className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {characters.map((character) => {
            const creators = [...new Set(character.sources.map((source) => source.creatorName).filter(Boolean))];
            const platforms = [...new Set(character.sources.map((source) => source.platform))];
            return <Link key={character.id} href={`/characters/${character.id}`} className="group overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/45 transition hover:-translate-y-0.5 hover:border-violet-500/40 hover:bg-zinc-900/70"><div className="flex gap-4 p-4"><CharacterAvatar name={character.name} src={character.avatarUrl} className="h-28 w-21 rounded-lg" /><div className="min-w-0 flex-1"><div className="flex flex-wrap gap-1.5">{platforms.map((platform) => <SourceBadge key={platform} platform={platform} />)}<StatusBadge status={character.status} /></div><h2 className="mt-3 truncate text-lg font-semibold text-zinc-100 group-hover:text-violet-200">{character.name}</h2><p className="mt-1 truncate text-sm text-zinc-500">by {creators.length > 0 ? creators.join(", ") : "Unknown creator"}</p><div className="mt-3 flex flex-wrap gap-1.5">{character.tags.slice(0, 3).map((tag) => <span key={tag.slug} className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{tag.name}</span>)}</div></div></div></Link>;
          })}
        </section>
      )}
    </div>
  );
}
