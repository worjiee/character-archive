import { connection } from "next/server";
import { BlockedDashboard } from "@/components/blocked-dashboard";
import { requireAdminPageSession } from "@/src/lib/auth";
import { getBlockedDashboardData } from "@/src/lib/moderation";

export default async function BlockedPage() {
  await connection();
  await requireAdminPageSession();
  return <BlockedDashboard data={await getBlockedDashboardData()} />;
}
