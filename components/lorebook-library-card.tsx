import Link from "next/link";
import type { LorebookListItem } from "../src/lib/lorebooks/repository";
import { SourceBadge } from "./character-badges";
import { lorebookDetailHref } from "./lorebook-library-utils";

export function LorebookLibraryCard({ lorebook }: { lorebook: LorebookListItem }) {
  return (
    <article className="archive-panel group relative min-w-0 overflow-hidden transition hover:border-[var(--accent-border)] hover:bg-zinc-900/45">
      <Link
        href={lorebookDetailHref(lorebook.id)}
        className="archive-focus block h-full rounded-xl p-4 sm:p-5"
        aria-label={`Open lorebook ${lorebook.title}`}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <SourceBadge platform={lorebook.sourcePlatform} variant="compact" />
            <h2 className="mt-3 line-clamp-2 break-words text-sm font-semibold leading-5 text-zinc-100 transition group-hover:text-violet-300">
              {lorebook.title}
            </h2>
          </div>
          <span aria-hidden="true" className="shrink-0 text-lg text-zinc-700 transition group-hover:translate-x-0.5 group-hover:text-violet-400">→</span>
        </div>
        <p className="mt-2 line-clamp-3 min-h-[3.75rem] break-words text-xs leading-5 text-zinc-500">
          {lorebook.description ?? "No summary has been provided for this lorebook."}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3 text-[10px] text-zinc-500">
          <div><dt className="sr-only">Entries</dt><dd><strong className="font-semibold tabular-nums text-zinc-300">{lorebook.entryCount}</strong> {pluralize(lorebook.entryCount, "entry", "entries")}</dd></div>
          <div><dt className="sr-only">Attached characters</dt><dd><strong className="font-semibold tabular-nums text-zinc-300">{lorebook.characterCount}</strong> {pluralize(lorebook.characterCount, "character", "characters")}</dd></div>
        </dl>
        <p className="mt-3 text-[9px] font-medium uppercase tracking-[0.12em] text-zinc-600">
          Updated {formatDate(lorebook.updatedAt)}
        </p>
      </Link>
    </article>
  );
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(value);
}
