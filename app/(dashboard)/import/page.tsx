import { ImportWorkflow } from "@/components/import-workflow";
import { THERON_CHARACTER_URL } from "@/src/lib/importers/development";

export default function ImportPage() {
  return <ImportWorkflow initialUrl={THERON_CHARACTER_URL} />;
}
