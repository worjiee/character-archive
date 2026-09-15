import Link from "next/link";
import type { CharacterVersionListItem } from "@/src/lib/characters/versions/service";
import type { CharacterVersionOrigin } from "@/src/lib/characters/versions/types";

function formatVersionDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function OriginBadge({ origin }: { origin: CharacterVersionOrigin }) {
  const config: Record<
    CharacterVersionOrigin,
    { label: string; bg: string; text: string; border: string }
  > = {
    BASELINE: {
      label: "Baseline",
      bg: "bg-zinc-800/60",
      text: "text-zinc-300",
      border: "border-zinc-700",
    },
    IMPORT: {
      label: "Import",
      bg: "bg-blue-950/40",
      text: "text-blue-300",
      border: "border-blue-800/60",
    },
    REIMPORT: {
      label: "Source Sync",
      bg: "bg-cyan-950/40",
      text: "text-cyan-300",
      border: "border-cyan-800/60",
    },
    ADMIN_EDIT: {
      label: "Admin Edit",
      bg: "bg-purple-950/40",
      text: "text-purple-300",
      border: "border-purple-800/60",
    },
    GREETING_EDIT: {
      label: "Greeting Edit",
      bg: "bg-amber-950/40",
      text: "text-amber-300",
      border: "border-amber-800/60",
    },
  };

  const style = config[origin] ?? config.BASELINE;

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border ${style.bg} ${style.text} ${style.border}`}
    >
      {style.label}
    </span>
  );
}

export function CharacterVersionHistory({
  characterId,
  currentVersionNumber,
  versions,
}: {
  characterId: string;
  currentVersionNumber: number;
  versions: CharacterVersionListItem[];
}) {
  if (!versions || versions.length === 0) {
    return (
      <p className="text-xs text-zinc-500 italic">No version history recorded yet.</p>
    );
  }

  const hasMultipleVersions = versions.length > 1;

  return (
    <div className="space-y-4">
      {hasMultipleVersions && (
        <div className="flex items-center justify-between border-b border-zinc-800/60 pb-3">
          <p className="text-xs text-zinc-400">
            {versions.length} recorded versions in archive
          </p>
          <Link
            href={`/characters/${encodeURIComponent(characterId)}/compare?from=${versions[versions.length - 1].versionNumber}&to=${currentVersionNumber}`}
            className="archive-focus inline-flex items-center gap-1.5 rounded-md border border-violet-700/60 bg-violet-950/30 px-2.5 py-1 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-900/40 hover:text-violet-100"
          >
            <span>Compare v{versions[versions.length - 1].versionNumber} → v{currentVersionNumber}</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      )}

      <div className="divide-y divide-zinc-800/50">
        {versions.map((version) => {
          const isCurrent = version.versionNumber === currentVersionNumber;

          return (
            <div
              key={version.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 transition-colors ${
                isCurrent ? "bg-zinc-900/40 -mx-2 px-2 rounded-lg" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold text-zinc-100">
                    v{version.versionNumber}
                  </span>
                  {isCurrent && (
                    <span className="inline-flex items-center rounded bg-emerald-950/60 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-800/60">
                      CURRENT
                    </span>
                  )}
                  <OriginBadge origin={version.origin} />
                  <span className="text-xs text-zinc-400">
                    {formatVersionDate(version.createdAt)}
                  </span>
                  {version.tokenCount != null && (
                    <span className="font-mono text-[10px] text-zinc-500">
                      {version.tokenCount.toLocaleString()} tokens
                    </span>
                  )}
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-zinc-400">
                  {version.changeSummary && (
                    <span className="text-zinc-300 font-medium">
                      {version.changeSummary}
                    </span>
                  )}
                  {version.createdBy && (
                    <span className="text-zinc-500">
                      by {version.createdBy.displayName || version.createdBy.username}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-center">
                <Link
                  href={`/characters/${encodeURIComponent(characterId)}/versions/${version.versionNumber}`}
                  className="archive-focus inline-flex items-center rounded border border-zinc-700 bg-zinc-800/60 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-zinc-700 hover:text-zinc-100"
                >
                  View
                </Link>
                {!isCurrent && (
                  <Link
                    href={`/characters/${encodeURIComponent(characterId)}/compare?from=${version.versionNumber}&to=${currentVersionNumber}`}
                    className="archive-focus inline-flex items-center rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                  >
                    Compare to current
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
