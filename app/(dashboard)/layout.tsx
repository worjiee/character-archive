import { DashboardNav } from "@/components/dashboard-nav";
import { RepositoryBrand } from "@/components/repository-brand";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getRepositorySettings } from "@/src/lib/settings";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerPageSession();
  const settings = await getRepositorySettings();
  return (
    <div className="archive-background min-h-screen">
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-[color-mix(in_srgb,var(--background)_92%,transparent)] backdrop-blur-xl">
        <div className="archive-container flex h-14 items-center gap-3">
          <RepositoryBrand settings={settings} compact />
          <div className="ml-auto min-w-0 lg:ml-1 lg:flex-1">
            <DashboardNav />
          </div>
        </div>
      </header>
      <main className="archive-container min-h-[calc(100vh-3.5rem)] py-5 sm:py-6 lg:py-7">{children}</main>
    </div>
  );
}
