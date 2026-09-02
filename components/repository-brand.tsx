import type { RepositorySettingsDto } from "@/src/lib/settings";
import { BrandLogo } from "./brand-logo";

export function RepositoryBrand({
  settings,
  presentation = "default",
}: {
  settings: RepositorySettingsDto;
  presentation?: "default" | "compact" | "login";
}) {
  const compact = presentation === "compact";
  const login = presentation === "login";

  return (
    <div className={`repository-brand ${login ? "repository-brand-login" : ""}`}>
      <BrandLogo
        configuredLogoUrl={settings.logoUrl}
        animated={login}
        size={login ? "login" : compact ? "header" : "standard"}
      />
      <div className={`min-w-0 ${login ? "text-center" : ""}`}>
        <div className={`repository-brand-title ${login ? "repository-brand-title-login" : ""}`}>{settings.siteName}</div>
        {login
          ? <div className="repository-brand-access">Private access</div>
          : !compact && settings.siteSubtitle && <div className="repository-brand-subtitle">{settings.siteSubtitle}</div>}
      </div>
    </div>
  );
}
