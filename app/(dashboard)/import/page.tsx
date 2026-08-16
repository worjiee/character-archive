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
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">Sources</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">Import a character</h1>
        <div className="mt-7 rounded-xl border border-zinc-800 bg-zinc-900/45 p-6">
          <h2 className="text-lg font-semibold text-zinc-100">Importing unavailable</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            {LIVE_IMPORT_UNAVAILABLE_MESSAGE}
          </p>
          <p className="mt-3 text-xs leading-5 text-zinc-500">
            Development fixtures are disabled in staging and production. Existing repository content remains available.
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
