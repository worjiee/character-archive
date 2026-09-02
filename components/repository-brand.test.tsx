import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RepositorySettingsDto } from "@/src/lib/settings";
import {
  CHARACTER_ARCHIVE_ANIMATED_LOGO,
  CHARACTER_ARCHIVE_STATIC_LOGO,
} from "./brand-logo";
import { RepositoryBrand } from "./repository-brand";

const settings: RepositorySettingsDto = {
  id: "singleton",
  siteName: "Character Archive",
  siteSubtitle: "Private repository",
  logoUrl: null,
  accentColor: "#d6a84b",
  defaultTheme: "SYSTEM",
};

describe("RepositoryBrand", () => {
  it("renders the approved static fallback beside the configured site name", () => {
    const html = renderToStaticMarkup(<RepositoryBrand settings={settings} presentation="compact" />);

    expect(html).toContain(`src="${CHARACTER_ARCHIVE_STATIC_LOGO}"`);
    expect(html).toContain("Character Archive");
    expect(html).not.toContain("accent-solid");
    expect(html).not.toContain('role="img"');
    expect(html).toContain('alt=""');
  });

  it("preserves an administrator logo override ahead of the approved fallback", () => {
    const html = renderToStaticMarkup(
      <RepositoryBrand settings={{ ...settings, logoUrl: "/custom-logo.svg" }} presentation="compact" />,
    );

    expect(html).toContain('src="/custom-logo.svg"');
    expect(html).not.toContain(CHARACTER_ARCHIVE_STATIC_LOGO);
  });

  it("uses the approved animation on login with a static reduced-motion source", () => {
    const html = renderToStaticMarkup(<RepositoryBrand settings={settings} presentation="login" />);

    expect(html).toContain(`src="${CHARACTER_ARCHIVE_ANIMATED_LOGO}"`);
    expect(html).toContain(`srcSet="${CHARACTER_ARCHIVE_STATIC_LOGO}"`);
    expect(html).toContain('media="(prefers-reduced-motion: reduce)"');
    expect(html.match(/Character Archive/g)).toHaveLength(1);
    expect(html).toContain("Private access");
    expect(html).not.toContain("Private repository");
    expect(html).toContain('alt=""');
  });
});
