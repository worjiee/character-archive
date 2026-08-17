import Link from "next/link";
import { connection } from "next/server";
import { CharacterLibraryCard } from "@/components/character-library-card";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { listCharacters } from "@/src/lib/characters/repository";
import {
  isDevelopmentFixtureEnabled,
  LIVE_IMPORT_UNAVAILABLE_MESSAGE,
} from "@/src/lib/importers/development/availability";

export default async function CharactersPage() {
  await connection();
  await requireOwnerPageSession();
  const characters = await listCharacters();
  const emptyStateDescription = isDevelopmentFixtureEnabled()
    ? "Preview the development fixture and save it to create your first character."
    : `There are no characters in this repository yet. ${LIVE_IMPORT_UNAVAILABLE_MESSAGE}`;
  return (
    <div>
      <div className="flex flex-col justify-between gap-5 border-b border-zinc-800/80 pb-6 sm:flex-row sm:items-end">
        <div><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Private library</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-3xl">Characters</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">A curated archive of normalized character cards, greetings, source records, and lorebooks.</p></div>
        <div className="flex items-center gap-3"><span className="text-xs tabular-nums text-zinc-500">{characters.length} {characters.length === 1 ? "character" : "characters"}</span><Link href="/import" className="archive-focus accent-solid rounded-lg px-4 py-2.5 text-center text-xs font-semibold transition hover:brightness-110">＋ Import character</Link></div>
      </div>
      {characters.length === 0 ? (
        <section className="archive-surface mt-7 grid min-h-80 place-items-center rounded-xl border border-dashed px-6 py-14 text-center"><div><div className="accent-muted mx-auto grid h-12 w-12 place-items-center rounded-xl border text-xl">◇</div><h2 className="mt-4 text-sm font-medium text-zinc-200">Your repository is empty</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">{emptyStateDescription}</p><Link href="/import" className="archive-focus mt-5 inline-flex rounded-lg border border-zinc-700 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800">Open Import</Link></div></section>
      ) : (
        <section aria-label={`${characters.length} characters`} className="mt-6 grid grid-cols-1 gap-3 min-[360px]:grid-cols-2 sm:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {characters.map((character) => <CharacterLibraryCard key={character.id} character={character} />)}
        </section>
      )}
    </div>
  );
}
