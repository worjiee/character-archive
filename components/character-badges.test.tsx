import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SourceBadge } from "./character-badges";

describe("SourceBadge", () => {
  it("renders the compact source mark with an accessible full name", () => {
    const markup = renderToStaticMarkup(
      <SourceBadge platform="JANITOR_AI" variant="compact" />,
    );

    expect(markup).toContain("J.AI");
    expect(markup).not.toContain("J.AI Janitor AI");
    expect(markup).toContain("Source: Janitor AI");
    expect(markup).toContain('class="sr-only"');
    expect(markup).toContain('title="Janitor AI"');
  });

  it("renders simply J.AI without repeating the full label in normal variant for Janitor AI", () => {
    const markup = renderToStaticMarkup(<SourceBadge platform="JANITOR_AI" />);

    expect(markup).toContain("J.AI");
    expect(markup).not.toContain("J.AI Janitor AI");
    expect(markup).toContain("Source: Janitor AI");
    expect(markup).toContain('title="Janitor AI"');
  });

  it("renders the source mark and full label in the normal variant for other platforms", () => {
    const markup = renderToStaticMarkup(<SourceBadge platform="SAUCEPAN" />);

    expect(markup).toContain(">S<");
    expect(markup).toContain("Saucepan");
  });

  it("renders Datacat without the former legacy label", () => {
    const markup = renderToStaticMarkup(<SourceBadge platform="DATACAT" />);

    expect(markup).toContain("Datacat");
    expect(markup).not.toContain("Legacy source");
  });

  it("uses the neutral identity for an unknown platform", () => {
    const markup = renderToStaticMarkup(<SourceBadge platform="UNRECOGNIZED" />);

    expect(markup).toContain("Other");
    expect(markup).toContain("Source: Other");
  });
});
