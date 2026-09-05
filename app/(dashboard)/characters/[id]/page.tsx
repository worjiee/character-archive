import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CharacterAvatar } from "../../../../components/character-avatar";
import { SourceBadge, StatusBadge } from "../../../../components/character-badges";
import { CharacterManagementPanel } from "../../../../components/character-management-panel";
import { CharacterRecordActions } from "../../../../components/character-record-actions";
import { SourceLinkActions } from "../../../../components/source-link-actions";
import { requireUserPageSession } from "../../../../src/lib/auth";
import { getCharacterById, type CharacterDetail } from "../../../../src/lib/characters/repository";
import { getSourceIdentity } from "../../../../src/lib/sources/presentation";
import { lorebookDetailHref } from "../../../../components/lorebook-library-utils";

export default async function CharacterDetailPage({ params }: PageProps<"/characters/[id]">) {
  await connection();
  const principal = await requireUserPageSession();
  const { id } = await params;
  const character = await getCharacterById(id, principal);
  if (!character) notFound();
  const visibleGreetings = character.greetings.filter((greeting) => !greeting.hidden);
  const creators = [...new Set(character.sources.map((source) => source.creatorName).filter(Boolean))];

  return (
    <div className="mx-auto max-w-[82rem] pb-12">
      <Link
        href="/characters"
        className="archive-link archive-focus inline-flex items-center gap-2 rounded-md text-xs font-medium"
      >
        <span aria-hidden="true">←</span>Characters
      </Link>

      {/* Header & Sidebar Metadata */}
      <section className="mt-4 grid gap-6 border-b border-zinc-800/80 pb-6 md:grid-cols-[240px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="mx-auto w-full max-w-[260px] md:mx-0">
          <CharacterAvatar
            name={character.name}
            src={character.avatarUrl}
            className="aspect-[3/4] w-full rounded-xl shadow-2xl shadow-black/30"
          />
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={character.status} />
            {character.sources.map((source) => (
              <SourceBadge
                key={`${source.platform}-${source.sourceUrl}`}
                platform={source.platform}
                variant="compact"
              />
            ))}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col justify-between">
          <div>
            <p className="archive-eyebrow">Character record</p>
            <h1 className="mt-1.5 break-words text-3xl font-semibold leading-tight tracking-[-0.035em] text-zinc-50 sm:text-[2.2rem]">
              {character.name}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              by{" "}
              <span className="font-medium text-zinc-200">
                {creators.length > 0 ? creators.join(", ") : "Unknown creator"}
              </span>
            </p>

            {character.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {character.tags.slice(0, 10).map((tag) => (
                  <Link
                    key={tag.slug}
                    href={`/characters?tag=${encodeURIComponent(tag.slug)}`}
                    className="archive-focus inline-flex items-center rounded-md border border-zinc-800 bg-zinc-900/65 px-2 py-1 text-[10px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                  >
                    {tag.name}
                  </Link>
                ))}
                {character.tags.length > 10 && (
                  <a
                    href="#tags-section"
                    className="archive-focus inline-flex items-center rounded-md border border-zinc-800/80 bg-zinc-900/40 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    +{character.tags.length - 10} more
                  </a>
                )}
              </div>
            )}

            <div className="mt-5">
              <CharacterRecordActions
                characterId={character.id}
                characterName={character.name}
                role={principal.role}
                status={character.status}
              />
            </div>
          </div>

          <div className="mt-6 border-t border-zinc-800/60 pt-4 text-[10px]">
            <p className="uppercase tracking-[0.12em] text-zinc-500">
              Updated {formatUpdatedDate(character.updatedAt)}
            </p>
            <p className="mt-1 text-zinc-500">
              Added by <span className="text-zinc-400">{character.uploaderName}</span>
              {character.publishedAt
                ? ` · First published ${formatUpdatedDate(character.publishedAt)}`
                : " · Not yet published"}
            </p>
            {character.blockedReason && (
              <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs leading-5 text-red-200">
                {character.blockedReason}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Structured Sections: only render if content exists */}
      <div className="space-y-2">
        {/* DESCRIPTION */}
        {character.description && (
          <RecordSection eyebrow="Overview" title="Description">
            <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {character.description}
            </p>
          </RecordSection>
        )}

        {/* PERSONALITY */}
        {character.personality && (
          <RecordSection eyebrow="Character sheet & psychology" title="Personality">
            <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {character.personality}
            </p>
          </RecordSection>
        )}

        {/* SCENARIO */}
        {character.scenario && (
          <RecordSection eyebrow="Context & setting" title="Scenario">
            <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {character.scenario}
            </p>
          </RecordSection>
        )}

        {/* EXAMPLE DIALOGS */}
        {character.exampleDialogs && (
          <RecordSection eyebrow="Dialog model" title="Example dialogs">
            <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
              {character.exampleDialogs}
            </p>
          </RecordSection>
        )}

        {/* GREETINGS */}
        {visibleGreetings.length > 0 && (
          <RecordSection
            eyebrow="Conversation openings"
            title="Greetings"
            count={visibleGreetings.length}
            contentClassName="p-3 sm:p-5"
          >
            {visibleGreetings.length === 1 ? (
              <SingleGreetingCard greeting={visibleGreetings[0]} />
            ) : (
              <ol className="space-y-3">
                {visibleGreetings.map((greeting, index) => (
                  <GreetingRow key={greeting.id} greeting={greeting} index={index} />
                ))}
              </ol>
            )}
          </RecordSection>
        )}

        {/* TAGS */}
        {character.tags.length > 0 && (
          <RecordSection
            id="tags-section"
            eyebrow="Taxonomy"
            title="Tags"
            count={character.tags.length}
          >
            <div className="flex flex-wrap gap-2">
              {character.tags.map((tag) => (
                <Link
                  key={tag.slug}
                  href={`/characters?tag=${encodeURIComponent(tag.slug)}`}
                  className="archive-focus inline-flex items-center rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
                >
                  <span className="mr-1 text-zinc-500">#</span>
                  <span>{tag.name}</span>
                </Link>
              ))}
            </div>
          </RecordSection>
        )}

        {/* LOREBOOKS */}
        {character.lorebooks.length > 0 && (
          <RecordSection
            eyebrow="World information"
            title="Lorebooks"
            count={character.lorebooks.length}
            contentClassName="p-3 sm:p-4"
          >
            <LorebookList lorebooks={character.lorebooks} />
          </RecordSection>
        )}

        {/* SOURCES / PROVENANCE */}
        {character.sources.length > 0 && (
          <RecordSection
            eyebrow="Provenance"
            title="Sources"
            count={character.sources.length}
            contentClassName="p-3 sm:p-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {character.sources.map((source) => (
                <article
                  key={`${source.platform}-${source.sourceUrl}`}
                  className="min-w-0 rounded-lg border border-zinc-800 bg-zinc-950/35 p-3.5 sm:p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceBadge platform={source.platform} variant="compact" />
                    <span className="min-w-0 truncate text-xs font-medium text-zinc-300">
                      {source.creatorName ?? "Unknown creator"}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[10px] text-zinc-500">
                    Source added by <span className="text-zinc-400">{source.addedBy}</span>
                  </p>
                  <a
                    href={source.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    title={source.sourceUrl}
                    aria-label={`Open source URL: ${source.sourceUrl}`}
                    className="archive-focus mt-2.5 block min-w-0 break-all rounded-sm text-xs leading-5 text-violet-400 hover:text-violet-300"
                  >
                    {source.sourceUrl}
                  </a>
                  <div className="mt-3">
                    <SourceLinkActions sourceUrl={source.sourceUrl} />
                  </div>
                </article>
              ))}
            </div>
          </RecordSection>
        )}

        {/* ADMIN MANAGEMENT */}
        {principal.role === "ADMIN" && character.status !== "DELETED" && (
          <div className="mt-8 border-t border-zinc-800/80 pt-6">
            <CharacterManagementPanel character={character} />
          </div>
        )}
      </div>
    </div>
  );
}

function RecordSection({
  id,
  eyebrow,
  title,
  count,
  children,
  className = "",
  contentClassName = "p-4 sm:p-6",
}: {
  id?: string;
  eyebrow: string;
  title: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section id={id} className={`border-t border-zinc-800/80 pt-6 ${className}`}>
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="archive-eyebrow text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            {eyebrow}
          </p>
          <h2 className="mt-1 text-base font-semibold uppercase tracking-wide text-zinc-100 sm:text-lg">
            {title}
            {typeof count === "number" && (
              <span className="ml-2 font-mono text-xs font-normal text-zinc-500">· {count}</span>
            )}
          </h2>
        </div>
      </div>
      <div className={`archive-panel ${contentClassName}`}>{children}</div>
    </section>
  );
}

function SingleGreetingCard({ greeting }: { greeting: CharacterDetail["greetings"][number] }) {
  const platformLabel = getSourceIdentity(greeting.source.platform).label;
  return (
    <article className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-300">
            Initial greeting
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">
          {platformLabel}
          {greeting.source.creatorName ? ` · ${greeting.source.creatorName}` : ""}
        </span>
      </div>
      <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
        {greeting.content}
      </p>
    </article>
  );
}

function GreetingRow({
  greeting,
  index,
}: {
  greeting: CharacterDetail["greetings"][number];
  index: number;
}) {
  const isDefault = index === 0;
  const platformLabel = getSourceIdentity(greeting.source.platform).label;

  return (
    <li>
      <details
        open={isDefault}
        className="group rounded-lg border border-zinc-800 bg-zinc-950/45 transition-colors open:border-zinc-700/80"
      >
        <summary className="archive-focus grid cursor-pointer list-none grid-cols-[2.2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg p-3 marker:hidden sm:p-4">
          <span className="font-mono text-xs font-semibold text-violet-400">
            {String(index + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                  isDefault
                    ? "border border-violet-500/30 bg-violet-500/15 text-violet-300"
                    : "border border-zinc-700/60 bg-zinc-800/60 text-zinc-400"
                }`}
              >
                {isDefault ? "Default greeting" : `Alternative greeting ${index}`}
              </span>
              <span className="text-[10px] text-zinc-500">
                {platformLabel}
                {greeting.source.creatorName ? ` · ${greeting.source.creatorName}` : ""}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 text-zinc-500 group-open:hidden">
              {greeting.content}
            </p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500 transition group-open:text-violet-300">
            <span className="group-open:hidden">Expand ▾</span>
            <span className="hidden group-open:inline">Collapse ▴</span>
          </span>
        </summary>
        <div className="border-t border-zinc-800/80 px-4 py-4 sm:px-6 sm:py-5">
          <p className="max-w-5xl whitespace-pre-wrap break-words text-sm leading-7 text-zinc-300">
            {greeting.content}
          </p>
        </div>
      </details>
    </li>
  );
}

function LorebookList({ lorebooks }: { lorebooks: CharacterDetail["lorebooks"] }) {
  return (
    <div className="space-y-3">
      {lorebooks.map((lorebook) => (
        <article key={lorebook.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/45">
          <div className="p-3 sm:px-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge platform={lorebook.sourcePlatform} variant="compact" />
                  <Link
                    href={lorebookDetailHref(lorebook.id)}
                    className="archive-link archive-focus break-words rounded-sm text-sm font-semibold"
                  >
                    {lorebook.title}
                  </Link>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-zinc-500">
                    {lorebook.entries.length} {lorebook.entries.length === 1 ? "entry" : "entries"}
                  </span>
                </div>
                {shouldShowLorebookDescription(lorebook.description) && (
                  <p className="mt-2 line-clamp-2 max-w-3xl text-xs leading-5 text-zinc-500">
                    {lorebook.description}
                  </p>
                )}
              </div>
              <Link
                href={lorebookDetailHref(lorebook.id)}
                className="archive-focus shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold text-zinc-500 hover:bg-zinc-800 hover:text-violet-300"
              >
                View lorebook →
              </Link>
            </div>
          </div>
          <details className="group border-t border-zinc-800">
            <summary className="archive-focus flex cursor-pointer list-none items-center justify-between rounded-b-lg px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500 marker:hidden hover:bg-zinc-900/60 hover:text-zinc-300 sm:px-4">
              <span>Attached entries</span>
              <span className="transition group-open:rotate-45">＋</span>
            </summary>
            <div className="grid gap-2 border-t border-zinc-800 p-3">
              {lorebook.entries.map((entry) => (
                <LorebookEntry key={entry.id} entry={entry} />
              ))}
              {lorebook.entries.length === 0 && (
                <p className="py-4 text-center text-sm text-zinc-600">
                  This lorebook currently has no imported entries.
                </p>
              )}
            </div>
          </details>
        </article>
      ))}
    </div>
  );
}

function LorebookEntry({ entry }: { entry: CharacterDetail["lorebooks"][number]["entries"][number] }) {
  return (
    <details className="group/entry rounded-lg border border-zinc-800 bg-zinc-900/50">
      <summary className="archive-focus cursor-pointer list-none rounded-lg p-3 marker:hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h3 className="break-words text-xs font-medium text-zinc-200">
              {entry.comment ?? entry.category ?? `Entry ${entry.externalEntryId}`}
            </h3>
            {entry.comment && entry.category && (
              <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">{entry.category}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {entry.keys.length > 0 ? (
                entry.keys.map((key) => (
                  <code key={key} className="accent-muted rounded border px-1.5 py-0.5 text-[10px]">
                    {key}
                  </code>
                ))
              ) : (
                <span className="text-[10px] text-zinc-600">No activation keys</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1">
            <EntryState enabled={entry.enabled} label={entry.enabled ? "Enabled" : "Disabled"} />
            <EntryState enabled={entry.constant} label={entry.constant ? "Constant" : "Conditional"} />
            <span className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-zinc-500">
              Order {entry.insertionOrder}
            </span>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-zinc-500 group-open/entry:hidden">
          {entry.content}
        </p>
      </summary>
      <p className="max-w-4xl whitespace-pre-wrap border-t border-zinc-800 px-4 py-4 text-sm leading-7 text-zinc-300">
        {entry.content}
      </p>
    </details>
  );
}

function EntryState({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <span
      className={`rounded px-2 py-1 text-[9px] ${
        enabled ? "bg-emerald-500/10 text-emerald-300" : "bg-zinc-800 text-zinc-500"
      }`}
    >
      {label}
    </span>
  );
}

function formatUpdatedDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function shouldShowLorebookDescription(value: string | null): value is string {
  return (
    value !== null &&
    (process.env.NODE_ENV === "development" || !/\b(?:synthetic\s+)?development fixture\b/i.test(value))
  );
}
