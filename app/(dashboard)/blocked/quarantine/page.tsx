import { connection } from "next/server";
import { QuarantineManagement } from "@/components/blocked-dashboard";
import { ModerationShell } from "@/components/moderation-shell";
import { requireAdminPageSession } from "@/src/lib/auth";
import { getQuarantineData } from "@/src/lib/moderation";

export default async function QuarantinePage() {
  await connection();
  await requireAdminPageSession();
  return (
    <ModerationShell active="quarantine" title="Quarantine" description="Review deterministic matches, their source context, and decide whether to restore or permanently block each character.">
      <QuarantineManagement data={await getQuarantineData()} />
    </ModerationShell>
  );
}
