export function StatusBadge({ status }: { status: string }) {
  const colors = status === "ACTIVE"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : status === "BLOCKED"
      ? "border-red-500/20 bg-red-500/10 text-red-300"
      : "border-amber-500/20 bg-amber-500/10 text-amber-300";

  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${colors}`}>{formatLabel(status)}</span>;
}

export function SourceBadge({ platform }: { platform: string }) {
  return <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300">{formatLabel(platform)}</span>;
}

function formatLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
