import { connection } from "next/server";
import { BlockRulesManagement } from "@/components/blocked-dashboard";
import { ModerationShell } from "@/components/moderation-shell";
import { requireAdminPageSession } from "@/src/lib/auth";
import { getBlockRulesData } from "@/src/lib/moderation";

export default async function BlockRulesPage() {
  await connection();
  await requireAdminPageSession();
  return (
    <ModerationShell active="rules" title="Block Rules" description="Manage character-name, keyword, tag, creator-name, and creator-ID rules used during moderation.">
      <BlockRulesManagement data={await getBlockRulesData()} />
    </ModerationShell>
  );
}
