import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireUserPageSession } from "@/src/lib/auth";
import { getCharacterVersionComparison } from "@/src/lib/characters/versions";
import { CharacterAvatar } from "@/components/character-avatar";

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default async function CharacterVersionComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await connection();
  const principal = await requireUserPageSession();
  const { id } = await params;
  const { from: rawFrom, to: rawTo } = await searchParams;

  const fromVersionNum = rawFrom ? parseInt(rawFrom, 10) : 1;
  const toVersionNum = rawTo ? parseInt(rawTo, 10) : 1;

  if (isNaN(fromVersionNum) || isNaN(toVersionNum) || fromVersionNum < 1 || toVersionNum < 1) {
    notFound();
  }

  const data = await getCharacterVersionComparison(id, fromVersionNum, toVersionNum, principal);
  if (!data) {
    notFound();
  }

  const { character, fromVersion, toVersion, allVersions, diff } = data;

  const fromArtworkUrl = fromVersion.snapshot.artwork.sha256
    ? `/api/characters/${encodeURIComponent(id)}/artwork?v=${fromVersion.snapshot.artwork.sha256}`
    : fromVersion.snapshot.character.avatarUrl;

  const toArtworkUrl = toVersion.snapshot.artwork.sha256
    ? `/api/characters/${encodeURIComponent(id)}/artwork?v=${toVersion.snapshot.artwork.sha256}`
    : toVersion.snapshot.character.avatarUrl;

  return (
    <div className="mx-auto max-w-[82rem] pb-16">
      {/* Back Link */}
      <Link
        href={`/characters/${encodeURIComponent(id)}`}
        className="archive-link archive-focus inline-flex items-center gap-2 rounded-md text-xs font-medium"
      >
        <span aria-hidden="true">←</span> Back to Character Record ({character.name})
      </Link>

      {/* Header & Version Selector */}
      <div className="mt-4 flex flex-col gap-4 border-b border-zinc-800/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="archive-eyebrow">Revision Comparison</p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
            COMPARE v{fromVersion.versionNumber} → v{toVersion.versionNumber}
          </h1>
          <p className="mt-1 text-xs text-zinc-400">
            Comparing historical snapshot from {formatDateTime(fromVersion.createdAt)} against {formatDateTime(toVersion.createdAt)}
          </p>
        </div>

        {/* Version Switcher Bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
          <span className="font-medium text-zinc-400">Versions:</span>
          {allVersions.map((v) => (
            <div key={v.versionNumber} className="flex items-center gap-1">
              <Link
                href={`/characters/${encodeURIComponent(id)}/compare?from=${v.versionNumber}&to=${toVersion.versionNumber}`}
                className={`archive-focus rounded px-2 py-1 font-mono transition-colors ${
                  v.versionNumber === fromVersion.versionNumber
                    ? "bg-amber-950/70 text-amber-300 border border-amber-700/60"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title={`Set v${v.versionNumber} as 'From'`}
              >
                v{v.versionNumber} (From)
              </Link>
              <Link
                href={`/characters/${encodeURIComponent(id)}/compare?from=${fromVersion.versionNumber}&to=${v.versionNumber}`}
                className={`archive-focus rounded px-2 py-1 font-mono transition-colors ${
                  v.versionNumber === toVersion.versionNumber
                    ? "bg-violet-950/70 text-violet-300 border border-violet-700/60"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
                title={`Set v${v.versionNumber} as 'To'`}
              >
                v{v.versionNumber} (To)
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Structured Summary Bar */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Structured Change Summary
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {/* Name */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Name</span>
            <p className="mt-1 text-sm font-semibold">
              {diff.fields.name.changed ? (
                <span className="text-violet-400">Changed</span>
              ) : (
                <span className="text-zinc-400">Unchanged</span>
              )}
            </p>
          </div>

          {/* Personality */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Personality</span>
            <p className="mt-1 text-sm font-semibold">
              {diff.fields.personality.changed ? (
                <span className="text-violet-400">Changed</span>
              ) : (
                <span className="text-zinc-400">Unchanged</span>
              )}
            </p>
          </div>

          {/* Scenario */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Scenario</span>
            <p className="mt-1 text-sm font-semibold">
              {diff.fields.scenario.changed ? (
                <span className="text-violet-400">Changed</span>
              ) : (
                <span className="text-zinc-400">Unchanged</span>
              )}
            </p>
          </div>

          {/* Greetings */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Greetings</span>
            <p className="mt-1 text-sm font-semibold">
              {diff.greetings.countBefore} → {diff.greetings.countAfter}
              {diff.greetings.added.length > 0 && (
                <span className="ml-1.5 text-xs text-emerald-400 font-normal">+{diff.greetings.added.length}</span>
              )}
              {diff.greetings.removed.length > 0 && (
                <span className="ml-1 text-xs text-red-400 font-normal">-{diff.greetings.removed.length}</span>
              )}
            </p>
          </div>

          {/* Tokens */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Tokens</span>
            <p className="mt-1 text-sm font-semibold">
              {diff.tokens.beforeTokenCount != null ? diff.tokens.beforeTokenCount.toLocaleString() : "—"} →{" "}
              {diff.tokens.afterTokenCount != null ? diff.tokens.afterTokenCount.toLocaleString() : "—"}
              {diff.tokens.tokenDelta != null && diff.tokens.tokenDelta !== 0 && (
                <span
                  className={`ml-1.5 text-xs font-normal ${
                    diff.tokens.tokenDelta > 0 ? "text-amber-400" : "text-cyan-400"
                  }`}
                >
                  {diff.tokens.tokenDelta > 0 ? `+${diff.tokens.tokenDelta}` : diff.tokens.tokenDelta}
                </span>
              )}
            </p>
          </div>

          {/* Artwork */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 p-3">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Artwork</span>
            <p className="mt-1 text-sm font-semibold">
              {diff.artwork.changed ? (
                <span className="text-violet-400">Changed</span>
              ) : (
                <span className="text-zinc-400">Unchanged</span>
              )}
            </p>
          </div>
        </div>

        {/* Tags Delta */}
        {(diff.tags.added.length > 0 || diff.tags.removed.length > 0) && (
          <div className="mt-4 border-t border-zinc-800/60 pt-3 text-xs">
            <span className="text-zinc-400 font-medium">Tag changes: </span>
            {diff.tags.added.map((t) => (
              <span
                key={t}
                className="ml-1.5 inline-flex items-center rounded bg-emerald-950/60 px-1.5 py-0.5 text-emerald-400 border border-emerald-800/50"
              >
                + {t}
              </span>
            ))}
            {diff.tags.removed.map((t) => (
              <span
                key={t}
                className="ml-1.5 inline-flex items-center rounded bg-red-950/60 px-1.5 py-0.5 text-red-400 border border-red-800/50"
              >
                - {t}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Side-by-Side (Desktop) / Stacked (Mobile) Prose Comparisons */}
      <div className="mt-8 space-y-6">
        {/* Name */}
        {diff.fields.name.changed && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Name Change
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-red-400">v{fromVersion.versionNumber} (Before)</span>
                <p className="mt-1 text-sm text-zinc-200">{diff.fields.name.before}</p>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-emerald-400">v{toVersion.versionNumber} (After)</span>
                <p className="mt-1 text-sm text-zinc-200">{diff.fields.name.after}</p>
              </div>
            </div>
          </section>
        )}

        {/* Description */}
        {diff.fields.description.changed && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Description Change
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-red-400">v{fromVersion.versionNumber} (Before)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.description.before || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-emerald-400">v{toVersion.versionNumber} (After)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.description.after || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Personality */}
        {diff.fields.personality.changed && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Personality Change
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-red-400">v{fromVersion.versionNumber} (Before)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.personality.before || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-emerald-400">v{toVersion.versionNumber} (After)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.personality.after || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Scenario */}
        {diff.fields.scenario.changed && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Scenario Change
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-red-400">v{fromVersion.versionNumber} (Before)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.scenario.before || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-emerald-400">v{toVersion.versionNumber} (After)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.scenario.after || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Example Dialogs */}
        {diff.fields.exampleDialogs.changed && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Example Dialogs Change
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-red-400">v{fromVersion.versionNumber} (Before)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.exampleDialogs.before || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-3">
                <span className="text-[10px] uppercase font-bold text-emerald-400">v{toVersion.versionNumber} (After)</span>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {diff.fields.exampleDialogs.after || <span className="italic text-zinc-500">Empty</span>}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Artwork Change */}
        {diff.artwork.changed && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Artwork Change
            </h3>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-red-900/40 bg-red-950/10 p-4 flex flex-col items-center">
                <span className="text-[10px] uppercase font-bold text-red-400 mb-2">v{fromVersion.versionNumber} (Before)</span>
                <CharacterAvatar
                  name={fromVersion.snapshot.character.name}
                  src={fromArtworkUrl}
                  className="w-32 aspect-[3/4] rounded-lg shadow-md"
                />
              </div>
              <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-4 flex flex-col items-center">
                <span className="text-[10px] uppercase font-bold text-emerald-400 mb-2">v{toVersion.versionNumber} (After)</span>
                <CharacterAvatar
                  name={toVersion.snapshot.character.name}
                  src={toArtworkUrl}
                  className="w-32 aspect-[3/4] rounded-lg shadow-md"
                />
              </div>
            </div>
          </section>
        )}

        {/* If no changes detected between selected versions */}
        {!diff.hasChanges && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-8 text-center">
            <p className="text-sm font-medium text-zinc-300">
              No semantic differences found between v{fromVersion.versionNumber} and v{toVersion.versionNumber}.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Both versions share an identical creative definition and fingerprint.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
