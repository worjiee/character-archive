import { connection } from "next/server";
import { AccessManagementDashboard } from "@/components/access-management-dashboard";
import { requireAdminPageSession } from "@/src/lib/auth";
import { listManagedUsers } from "@/src/lib/users/access-management";

export default async function AccessManagementPage() {
  await connection();
  await requireAdminPageSession();
  return <AccessManagementDashboard users={await listManagedUsers()} />;
}
