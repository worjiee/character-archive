/* eslint-disable @next/next/no-img-element -- Native images preserve GIF animation and picture-based reduced-motion source selection. */

export const CHARACTER_ARCHIVE_STATIC_LOGO = "/branding/character-archive-logo.png";
export const CHARACTER_ARCHIVE_ANIMATED_LOGO = "/branding/character-archive-logo-animated.gif";

export function BrandLogo({
  configuredLogoUrl,
  animated = false,
  size = "standard",
}: {
  configuredLogoUrl?: string | null;
  animated?: boolean;
  size?: "header" | "standard" | "login";
}) {
  const configuredSource = configuredLogoUrl?.trim() || null;
  const useApprovedAnimation = animated && !configuredSource;

  return (
    <span className={`repository-logo repository-logo-${size}${useApprovedAnimation ? " repository-logo-approved-animation" : ""}`} aria-hidden="true">
      {useApprovedAnimation ? (
        <picture>
          <source media="(prefers-reduced-motion: reduce)" srcSet={CHARACTER_ARCHIVE_STATIC_LOGO} />
          <img
            src={CHARACTER_ARCHIVE_ANIMATED_LOGO}
            alt=""
            width={396}
            height={496}
          />
        </picture>
      ) : (
        <img
          src={configuredSource ?? CHARACTER_ARCHIVE_STATIC_LOGO}
          alt=""
          width={500}
          height={500}
        />
      )}
    </span>
  );
}
