import type { CSSProperties } from "react";
import { getSourceIdentity } from "../src/lib/sources/presentation";

export function StatusBadge({ status }: { status: string }) {
  const colors = status === "ACTIVE"
    ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
    : status === "BLOCKED"
      ? "border-red-500/20 bg-red-500/10 text-red-300"
      : "border-amber-500/20 bg-amber-500/10 text-amber-300";

  return <span className={`font-interface rounded-full border px-2.5 py-1 text-[11px] font-medium ${colors}`}>{formatLabel(status)}</span>;
}

export function SourceBadge({
  platform,
  variant = "normal",
}: {
  platform: string;
  variant?: "compact" | "normal";
}) {
  const identity = getSourceIdentity(platform);
  const style = { "--source-color": identity.color } as CSSProperties;

  return (
    <span
      title={variant === "compact" ? identity.label : undefined}
      className="source-badge inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm"
      style={style}
    >
      <span aria-hidden="true" className="source-badge-mark">{variant === "compact" ? identity.shortLabel : identity.mark}</span>
      {variant === "normal" && <span aria-hidden="true">{identity.label}</span>}
      <span className="sr-only">Source: {identity.label}</span>
    </span>
  );
}

function formatLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}
