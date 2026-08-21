import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeSourceOverview } from "./home-source-overview";

const sources = [
  { value: "JANITOR_AI" as const, label: "Janitor AI", count: 14 },
  { value: "SAUCEPAN" as const, label: "Saucepan", count: 3 },
  { value: "DATACAT" as const, label: "Datacat", count: 2 },
  { value: "OTHER" as const, label: "Other", count: 1 },
];

describe("HomeSourceOverview", () => {
  it("links All and each supported persisted source to character browsing", () => {
    const markup = renderToStaticMarkup(<HomeSourceOverview total={20} sources={sources} />);

    expect(markup).toContain('href="/characters"');
    expect(markup).toContain('href="/characters?source=JANITOR_AI"');
    expect(markup).toContain('href="/characters?source=SAUCEPAN"');
    expect(markup).toContain('href="/characters?source=DATACAT"');
  });

  it("keeps Janny disabled and never aliases Janny or Other to a source link", () => {
    const markup = renderToStaticMarkup(<HomeSourceOverview total={20} sources={sources} />);

    expect(markup).toContain("Janny");
    expect(markup).toContain("Coming soon");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toContain("source=JANNY");
    expect(markup).not.toContain("source=OTHER");
  });
});
