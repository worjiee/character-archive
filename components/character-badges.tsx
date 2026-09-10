import { formatCompactTokens, formatExactTokens, TOKEN_REFERENCE_TOOLTIP } from "../src/lib/characters/tokens";
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
  const isJanitorAi = identity.key === "JANITOR_AI";
  const isCompact = variant === "compact" || isJanitorAi;
  const style = { "--source-color": identity.color } as CSSProperties;

  return (
    <span
      title={identity.label}
      className="source-badge inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-sm"
      style={style}
    >
      <span aria-hidden="true" className="source-badge-mark">{isCompact ? identity.shortLabel : identity.mark}</span>
      {!isCompact && <span aria-hidden="true">{identity.label}</span>}
      <span className="sr-only">Source: {identity.label}</span>
    </span>
  );
}

function formatLabel(value: string): string {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function TokenBadge({
  tokenCount,
  variant = "exact",
  className = "",
}: {
  tokenCount: number | null | undefined;
  variant?: "compact" | "exact";
  className?: string;
}) {
  if (tokenCount == null || Number.isNaN(tokenCount)) return null;

  const label = variant === "compact" ? formatCompactTokens(tokenCount) : formatExactTokens(tokenCount);

  return (
    <span
      title={TOKEN_REFERENCE_TOOLTIP}
      className={`token-badge inline-flex items-center rounded-full border border-zinc-700/70 bg-zinc-900/80 px-2 py-0.5 text-[10px] font-medium text-zinc-300 backdrop-blur-sm cursor-help ${className}`}
    >
      <span className="font-mono tabular-nums tracking-wider uppercase text-zinc-200">{label}</span>
      <span className="sr-only">{TOKEN_REFERENCE_TOOLTIP}</span>
    </span>
  );
}
