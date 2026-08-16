import { DashboardNav } from "@/components/dashboard-nav";
import { requireOwnerPageSession } from "@/src/lib/auth";
import { getRepositorySettings } from "@/src/lib/settings";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerPageSession();
  const settings = await getRepositorySettings();
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(124,58,237,0.08),transparent_28rem)]">
      <header className="border-b border-zinc-800/80 bg-zinc-950/85 px-4 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between py-4">
          <Brand settings={settings} />
          <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">Private</span>
        </div>
        <div className="pb-3"><DashboardNav /></div>
      </header>
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-800/80 bg-zinc-950/70 p-5 backdrop-blur lg:flex lg:flex-col">
        <Brand settings={settings} />
        <div className="mt-10 flex-1"><DashboardNav /></div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/45 p-3.5">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]" />Private workspace</div>
          <p className="mt-2 text-xs leading-5 text-zinc-500">Repository access remains local and under your control.</p>
        </div>
      </aside>
      <main className="lg:pl-64"><div className="mx-auto min-h-screen max-w-7xl px-5 py-8 sm:px-8 lg:px-10 lg:py-10">{children}</div></main>
    </div>
  );
}

function Brand({ settings }: { settings: Awaited<ReturnType<typeof getRepositorySettings>> }) {
  return (
    <div className="flex items-center gap-3">
      <div role="img" aria-label={`${settings.siteName} logo`} className="brand-logo accent-solid grid h-9 w-9 place-items-center rounded-xl bg-cover bg-center text-sm font-bold shadow-lg shadow-violet-950/50" style={settings.logoUrl ? { backgroundImage: `url(${JSON.stringify(settings.logoUrl).slice(1, -1)})` } : undefined}>{settings.logoUrl ? null : settings.siteName.slice(0, 1).toUpperCase()}</div>
      <div><div className="text-sm font-semibold tracking-wide text-zinc-100">{settings.siteName}</div>{settings.siteSubtitle && <div className="max-w-40 truncate text-[11px] text-zinc-500">{settings.siteSubtitle}</div>}</div>
    </div>
  );
}
