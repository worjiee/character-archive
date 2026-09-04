export default function AuthorsLoading() {
  return (
    <div aria-label="Loading authors" aria-busy="true" className="space-y-6">
      <div className="h-20 animate-pulse rounded-xl border border-zinc-800/80 bg-zinc-900/30" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-44 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
        ))}
      </div>
    </div>
  );
}
