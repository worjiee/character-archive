import { requireOwnerPageSession } from "@/src/lib/auth";
import {
  isDevelopmentFixtureEnabled,
  LIVE_IMPORT_UNAVAILABLE_MESSAGE,
} from "@/src/lib/importers/development";

export default async function ImportPage() {
  await requireOwnerPageSession();
  if (!isDevelopmentFixtureEnabled()) {
    return (
      <div>
        <div className="border-b border-zinc-800/80 pb-6"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Add to library</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-3xl">Import a character</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Live source import tools will appear here when support is ready.</p></div>
        <div className="archive-surface mt-6 rounded-xl border p-5 sm:p-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-400">Source unavailable</p>
          <h2 className="mt-2 text-lg font-semibold text-zinc-100">Importing unavailable</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            {LIVE_IMPORT_UNAVAILABLE_MESSAGE}
          </p>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Existing repository content remains available to browse and manage while importing is completed.
          </p>
        </div>
      </div>
    );
  }

  const [{ ImportWorkflow }, { THERON_CHARACTER_URL }] = await Promise.all([
    import("@/components/import-workflow"),
    import("@/src/lib/importers/development/theron-fixture"),
  ]);
  return <ImportWorkflow initialUrl={THERON_CHARACTER_URL} />;
}
