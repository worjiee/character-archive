import { requireUserPageSession } from "@/src/lib/auth";
import { isDevelopmentFixtureEnabled } from "@/src/lib/importers/development";
import { readDeploymentCapabilities } from "@/src/lib/runtime/deployment";

export default async function ImportPage() {
  const principal = await requireUserPageSession();
  const fixtureEnabled = isDevelopmentFixtureEnabled();
  const capabilities = readDeploymentCapabilities();
  const { ImportWorkflow } = await import("@/components/import-workflow");
  const initialUrl = fixtureEnabled
    ? (await import("@/src/lib/importers/development/theron-fixture")).THERON_CHARACTER_URL
    : "";
  return (
    <ImportWorkflow
      automaticFixtureEnabled={fixtureEnabled}
      artifactUploadsEnabled={capabilities.artifactUploadsEnabled}
      experimentalImportsVisible={capabilities.experimentalImportsVisible}
      initialUrl={initialUrl}
      isAdmin={principal.role === "ADMIN"}
    />
  );
}
