import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewImportUnavailable } from "./preview-import-unavailable";

describe("PreviewImportUnavailable", () => {
  it("truthfully disables deployed artifacts without exposing a file control", () => {
    const html = renderToStaticMarkup(<PreviewImportUnavailable />);
    expect(html).toContain("Import uploads are temporarily unavailable in this preview");
    expect(html).toContain("browsing and review functionality");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Companion");
  });
});
