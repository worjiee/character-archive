import { connection } from "next/server";
import { BlockedDashboard } from "@/components/blocked-dashboard";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getBlockedDashboardData } from "@/src/lib/moderation";

export default async function BlockedPage() {
  await connection();
  await requireOwnerPageSession();
  return <BlockedDashboard data={await getBlockedDashboardData()} />;
}
