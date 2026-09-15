import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireUserPageSession } from "@/src/lib/auth";
import { getCharacterHistoricalVersion } from "@/src/lib/characters/versions";
import { CharacterAvatar } from "@/components/character-avatar";
import { TokenBadge } from "@/components/character-badges";

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export default async function CharacterHistoricalVersionPage({
  params,
}: {
  params: Promise<{ id: string; version: string }>;
}) {
  await connection();
  const principal = await requireUserPageSession();
  const { id, version: rawVersion } = await params;
  const versionNumber = parseInt(rawVersion, 10);

  if (isNaN(versionNumber) || versionNumber < 1) {
    notFound();
  }

  const data = await getCharacterHistoricalVersion(id, versionNumber, principal);
  if (!data) {
    notFound();
  }

  const { version, currentVersionNumber } = data;
  const { snapshot } = version;
  const isCurrent = version.versionNumber === currentVersionNumber;

  const artworkUrl = snapshot.artwork.sha256
    ? `/api/characters/${encodeURIComponent(id)}/artwork?v=${snapshot.artwork.sha256}`
    : snapshot.character.avatarUrl;

  return (
    <div className="mx-auto max-w-[82rem] pb-16">
      {/* Back Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={`/characters/${encodeURIComponent(id)}`}
          className="archive-link archive-focus inline-flex items-center gap-2 rounded-md text-xs font-medium"
        >
          <span aria-hidden="true">←</span> Back to Current Character Record
        </Link>
        {!isCurrent && (
          <Link
            href={`/characters/${encodeURIComponent(id)}/compare?from=${version.versionNumber}&to=${currentVersionNumber}`}
            className="archive-focus inline-flex items-center gap-1.5 rounded-md border border-violet-700/60 bg-violet-950/30 px-3 py-1.5 text-xs font-medium text-violet-300 transition-colors hover:bg-violet-900/40 hover:text-violet-100"
          >
            <span>Compare v{version.versionNumber} → v{currentVersionNumber} (Current)</span>
            <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>

      {/* Mandatory Amber READ ONLY Banner */}
      <div
        role="status"
        className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:p-5 text-amber-200 shadow-lg shadow-black/20"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" aria-hidden="true" />
            <h2 className="text-sm sm:text-base font-semibold tracking-wide uppercase">
              HISTORICAL VERSION — v{version.versionNumber} (Archived on {formatDateTime(version.createdAt)}) — READ ONLY
            </h2>
          </div>
          {isCurrent ? (
            <span className="inline-flex self-start sm:self-center items-center rounded-md bg-emerald-950/80 px-2.5 py-1 text-xs font-semibold text-emerald-400 border border-emerald-700">
              Matches Current Published Record
            </span>
          ) : (
            <span className="inline-flex self-start sm:self-center items-center rounded-md bg-amber-950/80 px-2.5 py-1 text-xs font-semibold text-amber-300 border border-amber-700/60">
              Older Historical Snapshot
            </span>
          )}
        </div>
        <p className="mt-2 text-xs sm:text-sm text-amber-200/80">
          This is an immutable historical snapshot from the archive. Any ongoing character changes apply to the current version.
        </p>
      </div>

      {/* Header & Character Snapshot Summary */}
      <section className="mt-6 grid gap-6 border-b border-zinc-800/80 pb-8 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="mx-auto w-full max-w-[260px] md:mx-0">
          <CharacterAvatar
            name={snapshot.character.name}
            src={artworkUrl}
            className="aspect-[3/4] w-full rounded-xl shadow-2xl shadow-black/30"
          />
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs font-mono font-medium text-zinc-200">
              v{version.versionNumber}
            </span>
            <span className="inline-flex items-center rounded border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs font-medium text-zinc-300">
              {version.origin}
            </span>
            {snapshot.tokenMetrics.tokenCount != null && (
              <TokenBadge tokenCount={snapshot.tokenMetrics.tokenCount} variant="exact" />
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="archive-eyebrow">Archived Snapshot</p>
              <span className="text-zinc-600">·</span>
              <span className="font-mono text-xs text-zinc-500">
                SHA: {version.fingerprint.substring(0, 12)}...
              </span>
            </div>
            <h1 className="mt-1.5 break-words text-3xl font-semibold leading-tight tracking-[-0.035em] text-zinc-50 sm:text-[2.2rem]">
              {snapshot.character.name}
            </h1>

            {version.changeSummary && (
              <p className="mt-2 text-sm text-zinc-300 bg-zinc-900/60 border border-zinc-800 rounded-lg p-3">
                <span className="font-medium text-zinc-400">Change summary: </span>
                {version.changeSummary}
              </p>
            )}

            {snapshot.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {snapshot.tags.map((tag) => (
                  <span
                    key={tag.slug}
                    className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/65 px-2 py-1 text-[10px] text-zinc-400"
                  >
                    #{tag.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 border-t border-zinc-800/60 pt-4 text-[10px] text-zinc-500 space-y-1">
            <p>
              Snapshot created {formatDateTime(version.createdAt)}
              {version.createdBy && ` by ${version.createdBy.displayName || version.createdBy.username}`}
            </p>
            <p className="font-mono text-zinc-600">
              Fingerprint: {version.fingerprint}
            </p>
          </div>
        </div>
      </section>

      {/* Snapshot Content Sections */}
      <div className="mt-8 space-y-6">
        {/* DESCRIPTION */}
        {snapshot.character.description && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Description
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {snapshot.character.description}
            </p>
          </section>
        )}

        {/* PERSONALITY */}
        {snapshot.character.personality && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Personality
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {snapshot.character.personality}
            </p>
          </section>
        )}

        {/* SCENARIO */}
        {snapshot.character.scenario && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Scenario
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {snapshot.character.scenario}
            </p>
          </section>
        )}

        {/* EXAMPLE DIALOGS */}
        {snapshot.character.exampleDialogs && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Example Dialogs
            </h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {snapshot.character.exampleDialogs}
            </p>
          </section>
        )}

        {/* PROMPT EXTENSIONS */}
        {(snapshot.promptExtensions.systemPrompt || snapshot.promptExtensions.postHistoryInstructions) && (
          <section className="archive-panel p-4 sm:p-6 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Prompt Extensions
            </h3>
            {snapshot.promptExtensions.systemPrompt && (
              <div>
                <p className="text-xs font-medium text-zinc-400">System Prompt</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {snapshot.promptExtensions.systemPrompt}
                </p>
              </div>
            )}
            {snapshot.promptExtensions.postHistoryInstructions && (
              <div>
                <p className="text-xs font-medium text-zinc-400">Post-History Instructions</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                  {snapshot.promptExtensions.postHistoryInstructions}
                </p>
              </div>
            )}
          </section>
        )}

        {/* GREETINGS */}
        {snapshot.greetings.length > 0 && (
          <section className="archive-panel p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Greetings ({snapshot.greetings.length})
              </h3>
            </div>
            <ol className="mt-3 space-y-3">
              {snapshot.greetings.map((greeting) => (
                <li
                  key={`${greeting.position}-${greeting.content.slice(0, 20)}`}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-4"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-mono text-xs text-zinc-500">
                      #{greeting.position + 1}
                    </span>
                    {greeting.hidden && (
                      <span className="inline-flex items-center rounded bg-amber-950/60 px-1.5 py-0.5 text-[10px] text-amber-400 border border-amber-800/60">
                        Hidden
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-300">
                    {greeting.content}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* EMBEDDED LOREBOOKS */}
        {snapshot.lorebooks.length > 0 && (
          <section className="archive-panel p-4 sm:p-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Embedded Lorebooks ({snapshot.lorebooks.length})
            </h3>
            <div className="mt-3 space-y-4">
              {snapshot.lorebooks.map((lb) => (
                <div
                  key={lb.externalId}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-900/50 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-medium text-zinc-200">{lb.title}</h4>
                    <span className="text-xs text-zinc-500 font-mono">
                      {lb.entries.length} entries
                    </span>
                  </div>
                  {lb.description && (
                    <p className="mt-1 text-xs text-zinc-400">{lb.description}</p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
