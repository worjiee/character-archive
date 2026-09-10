import { connection } from "next/server";
import { BlockedCreatorsManagement } from "@/components/blocked-dashboard";
import { ModerationShell } from "@/components/moderation-shell";
import { requireAdminPageSession } from "@/src/lib/auth";
import { getBlockedCreatorsData } from "@/src/lib/moderation";

export default async function BlockedCreatorsPage() {
  await connection();
  await requireAdminPageSession();
  return (
    <ModerationShell active="creators" title="Blocked Creators" description="Manage creator blocks by platform, creator ID, or creator name with an optional reason.">
      <BlockedCreatorsManagement data={await getBlockedCreatorsData()} />
    </ModerationShell>
  );
}
