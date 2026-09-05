import { DashboardNav } from "@/components/dashboard-nav";
import { CharacterCollectionsProvider } from "@/components/character-collections-provider";
import { RepositoryBrand } from "@/components/repository-brand";
import { PreviewBuildBadge } from "@/components/preview-build-badge";
import { requireUserPageSession } from "@/src/lib/auth";
import { getCharacterCollectionState } from "@/src/lib/characters/collections";
import { getRepositorySettings } from "@/src/lib/settings";
import { readDeploymentCapabilities } from "@/src/lib/runtime/deployment";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const principal = await requireUserPageSession();
  const capabilities = readDeploymentCapabilities();
  const [settings, collections] = await Promise.all([
    getRepositorySettings(),
    getCharacterCollectionState(principal),
  ]);
  return (
    <CharacterCollectionsProvider key={principal.userId} initialState={collections} role={principal.role}>
      <div className="archive-background min-h-screen">
        <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-[color-mix(in_srgb,var(--background)_92%,transparent)] backdrop-blur-xl">
          <div className="archive-container flex h-14 items-center gap-3">
            <RepositoryBrand settings={settings} presentation="compact" />
            {capabilities.clientPreview && <PreviewBuildBadge />}
            <div className="ml-auto min-w-0 xl:ml-1 xl:flex-1">
              <DashboardNav role={principal.role} />
            </div>
          </div>
        </header>
        <main className="archive-container min-h-[calc(100vh-3.5rem)] py-5 sm:py-6 lg:py-7">{children}</main>
      </div>
    </CharacterCollectionsProvider>
  );
}
