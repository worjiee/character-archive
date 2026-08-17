import { requireOwnerPageSession } from "@/src/lib/auth";
import { isDevelopmentFixtureEnabled } from "@/src/lib/importers/development";

export default async function ImportPage() {
  await requireOwnerPageSession();
  const fixtureEnabled = isDevelopmentFixtureEnabled();
  const { ImportWorkflow } = await import("@/components/import-workflow");
  const initialUrl = fixtureEnabled
    ? (await import("@/src/lib/importers/development/theron-fixture")).THERON_CHARACTER_URL
    : "";
  return <ImportWorkflow automaticFixtureEnabled={fixtureEnabled} initialUrl={initialUrl} />;
}
