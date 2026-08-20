export default function CharactersLoading() {
  return (
    <div aria-label="Loading characters" aria-busy="true">
      <div className="h-24 animate-pulse border-b border-zinc-800/80 bg-zinc-900/20" />
      <div className="mt-5 grid gap-5 lg:grid-cols-[14.5rem_minmax(0,1fr)]">
        <div className="archive-panel hidden h-96 animate-pulse lg:block" />
        <div><div className="archive-panel h-24 animate-pulse" /><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index} className="aspect-[3/4] animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/45" />)}</div></div>
      </div>
    </div>
  );
}
