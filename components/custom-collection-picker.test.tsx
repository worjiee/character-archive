import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomCollectionPicker } from "./custom-collection-picker";

describe("CustomCollectionPicker component", () => {
  it("renders trigger button with accessible attributes in icon variant", () => {
    const html = renderToStaticMarkup(
      <CustomCollectionPicker characterId="char-1" characterName="Theron" variant="icon" />
    );

    expect(html).toContain('aria-label="Add Theron to collections"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-collection="custom"');
    expect(html).toContain("custom-collection-card-trigger");
    expect(html).not.toContain("character-collection-toggle-labeled");
  });

  it("renders labeled trigger button in labeled variant for record view", () => {
    const html = renderToStaticMarkup(
      <CustomCollectionPicker characterId="char-1" characterName="Theron" variant="labeled" />
    );

    expect(html).toContain('aria-label="Add Theron to collections"');
    expect(html).toContain("character-collection-toggle-labeled");
    expect(html).toContain("Collections");
  });

  it("does not render popover dialog in static markup when closed", () => {
    const html = renderToStaticMarkup(
      <CustomCollectionPicker characterId="char-1" characterName="Theron" />
    );

    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Add to Collection");
    expect(html).not.toContain("Create new collection");
  });
});
