export default function DashboardLoading() {
  return (
    <div aria-label="Loading page content" aria-busy="true" className="space-y-6">
      <div className="h-16 animate-pulse rounded-xl border border-zinc-800/60 bg-zinc-900/30" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="aspect-[3/4] animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
        ))}
      </div>
    </div>
  );
}
