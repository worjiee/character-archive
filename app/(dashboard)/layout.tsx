import { DashboardNav } from "@/components/dashboard-nav";
import { RepositoryBrand } from "@/components/repository-brand";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getRepositorySettings } from "@/src/lib/settings";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerPageSession();
  const settings = await getRepositorySettings();
  return (
    <div className="archive-background min-h-screen">
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/88 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <RepositoryBrand settings={settings} compact />
          <div className="ml-auto lg:ml-2 lg:flex-1">
            <DashboardNav />
          </div>
        </div>
      </header>
      <main className="mx-auto min-h-[calc(100vh-3.5rem)] max-w-[1680px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8 lg:py-10">{children}</main>
    </div>
  );
}
