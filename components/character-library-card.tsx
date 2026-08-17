import Link from "next/link";
import type { CharacterListItem } from "@/src/lib/characters/repository";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge, StatusBadge } from "./character-badges";

export function CharacterLibraryCard({ character }: { character: CharacterListItem }) {
  const creators = [...new Set(character.sources.map((source) => source.creatorName).filter(Boolean))];
  const platforms = [...new Set(character.sources.map((source) => source.platform))];
  return (
    <Link href={`/characters/${character.id}`} className="archive-focus group w-full min-w-0 max-w-[17rem] justify-self-start overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/55 transition duration-200 hover:-translate-y-0.5 hover:border-violet-500/45 hover:bg-zinc-900/80">
      <div className="relative aspect-[3/4] overflow-hidden bg-zinc-950">
        <CharacterAvatar name={character.name} src={character.avatarUrl} className="h-full w-full rounded-none ring-0 transition duration-300 group-hover:scale-[1.015]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-transparent" />
        <div className="absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-end justify-between gap-1.5">
          <div className="flex flex-wrap gap-1">{platforms.slice(0, 2).map((platform) => <SourceBadge key={platform} platform={platform} />)}</div>
          <StatusBadge status={character.status} />
        </div>
      </div>
      <div className="p-3 sm:p-3.5">
        <h2 className="line-clamp-2 min-h-[2.5rem] text-sm font-semibold leading-5 text-zinc-100 transition-colors group-hover:text-violet-200 sm:text-[15px]">{character.name}</h2>
        <p className="mt-1 truncate text-[11px] text-zinc-500">by {creators.length > 0 ? creators.join(", ") : "Unknown creator"}</p>
        <div className="mt-3 flex min-h-5 flex-wrap gap-1">{character.tags.slice(0, 3).map((tag) => <span key={tag.slug} className="max-w-full truncate rounded-md border border-zinc-800 bg-zinc-950/55 px-1.5 py-0.5 text-[10px] text-zinc-400">{tag.name}</span>)}{character.tags.length > 3 && <span className="px-1 py-0.5 text-[10px] text-zinc-600">+{character.tags.length - 3}</span>}</div>
      </div>
    </Link>
  );
}
