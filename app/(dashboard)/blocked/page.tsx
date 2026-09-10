import { connection } from "next/server";
import { ModerationOverview } from "@/components/blocked-dashboard";
import { LegacyModerationFragmentRedirect, ModerationShell } from "@/components/moderation-shell";
import { requireAdminPageSession } from "@/src/lib/auth";
import { getModerationOverviewData } from "@/src/lib/moderation";

export default async function BlockedPage() {
  await connection();
  await requireAdminPageSession();
  const data = await getModerationOverviewData();
  return (
    <ModerationShell
      active="overview"
      title="Moderation Overview"
      description="Review moderation status and open the focused tool that needs attention."
    >
      <LegacyModerationFragmentRedirect />
      <ModerationOverview data={data} />
    </ModerationShell>
  );
}
