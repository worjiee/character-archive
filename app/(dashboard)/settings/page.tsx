import { connection } from "next/server";
import { SettingsDashboard } from "@/components/settings-dashboard";
import { requireAdminPageSession } from "@/src/lib/auth";
import { listDeletedCharacters } from "@/src/lib/characters/repository";
import { getRepositorySettings } from "@/src/lib/settings";

export default async function SettingsPage() {
  await connection();
  await requireAdminPageSession();
  const [settings, deletedCharacters] = await Promise.all([
    getRepositorySettings(),
    listDeletedCharacters(),
  ]);
  return <SettingsDashboard settings={settings} deletedCharacters={deletedCharacters} />;
}
