import { ImportWorkflow } from "@/components/import-workflow";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { THERON_CHARACTER_URL } from "@/src/lib/importers/development";

export default async function ImportPage() {
  await requireOwnerPageSession();
  return <ImportWorkflow initialUrl={THERON_CHARACTER_URL} />;
}
