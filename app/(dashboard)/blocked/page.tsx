import { connection } from "next/server";
import { BlockedDashboard } from "@/components/blocked-dashboard";
import { getBlockedDashboardData } from "@/src/lib/moderation";

export default async function BlockedPage() {
  await connection();
  return <BlockedDashboard data={await getBlockedDashboardData()} />;
}
