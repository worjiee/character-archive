import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CharacterSourceNavigation } from "./character-source-navigation";
import { buildCharacterSourceNavigation } from "./character-library-utils";

const items = buildCharacterSourceNavigation(500, [
  { value: "JANITOR_AI", label: "Janitor AI", count: 410 },
  { value: "SAUCEPAN", label: "Saucepan", count: 70 },
  { value: "DATACAT", label: "Datacat", count: 20 },
  { value: "OTHER", label: "Other", count: 0 },
]);

describe("character source navigation", () => {
  it("renders database facet counts and centralized source labels", () => {
    const markup = renderToStaticMarkup(<CharacterSourceNavigation items={items} selectedKey="ALL" onSelect={vi.fn()} />);
    expect(markup).toContain("500");
    expect(markup).toContain("410");
    expect(markup).toContain("Datacat");
    expect(markup).not.toContain("Legacy source");
  });

  it("renders Janny as an accessible disabled coming-soon control", () => {
    const markup = renderToStaticMarkup(<CharacterSourceNavigation items={items} selectedKey="ALL" onSelect={vi.fn()} />);
    expect(markup).toContain('aria-label="Janny, coming soon"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Janny/);
  });

  it("renders Lorebooks as a separate enabled library destination", () => {
    const markup = renderToStaticMarkup(<CharacterSourceNavigation items={items} selectedKey="ALL" onSelect={vi.fn()} />);
    expect(markup).toContain('href="/lorebooks"');
    expect(markup).toContain('aria-label="Character source filters"');
  });
});
