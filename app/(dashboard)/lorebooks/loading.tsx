export default function LorebooksLoading() {
  return (
    <div aria-label="Loading lorebooks" aria-busy="true">
      <div className="h-24 animate-pulse border-b border-zinc-800/80 bg-zinc-900/20" />
      <div className="archive-panel mt-5 h-24 animate-pulse" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/45" />)}</div>
    </div>
  );
}
