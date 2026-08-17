import type { RepositorySettingsDto } from "@/src/lib/settings";

export function RepositoryBrand({
  settings,
  compact = false,
}: {
  settings: RepositorySettingsDto;
  compact?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div
        role="img"
        aria-label={`${settings.siteName} logo`}
        className={`accent-solid grid shrink-0 place-items-center overflow-hidden bg-cover bg-center font-bold ${compact ? "h-8 w-8 rounded-lg text-xs" : "h-10 w-10 rounded-xl text-sm"}`}
        style={settings.logoUrl ? { backgroundImage: `url(${JSON.stringify(settings.logoUrl).slice(1, -1)})` } : undefined}
      >
        {settings.logoUrl ? null : settings.siteName.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tracking-[-0.01em] text-zinc-100">{settings.siteName}</div>
        {!compact && settings.siteSubtitle && <div className="max-w-52 truncate text-[10px] uppercase tracking-[0.13em] text-zinc-500">{settings.siteSubtitle}</div>}
      </div>
    </div>
  );
}
