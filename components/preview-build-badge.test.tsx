import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewBuildBadge } from "./preview-build-badge";

describe("PreviewBuildBadge", () => {
  it("identifies the release unobtrusively without claiming production", () => {
    const html = renderToStaticMarkup(<PreviewBuildBadge />);
    expect(html).toContain("Client");
    expect(html).toContain("Preview");
    expect(html).not.toContain("Production");
  });
});
