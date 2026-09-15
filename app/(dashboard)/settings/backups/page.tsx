import { connection } from "next/server";
import { BackupRecoveryDashboard } from "@/components/backup-recovery-dashboard";
import { requireAdminPageSession } from "@/src/lib/auth";
import { getArchiveHealth } from "@/src/lib/backup/service";

export default async function BackupsPage() {
  await connection();
  await requireAdminPageSession();
  const health = await getArchiveHealth();
  return <BackupRecoveryDashboard initialHealth={health} />;
}
