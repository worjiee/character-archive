import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImportWorkflow } from "./import-workflow";

describe("ImportWorkflow client-preview capability", () => {
  it("shows the truthful unavailable state without artifact, Companion, or connector controls", () => {
    const html = renderToStaticMarkup(
      <ImportWorkflow
        automaticFixtureEnabled={false}
        artifactUploadsEnabled={false}
        experimentalImportsVisible={false}
        initialUrl=""
        isAdmin
      />,
    );
    expect(html).toContain("Import uploads are temporarily unavailable in this preview");
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("Alternative imports");
    expect(html).not.toContain("Janitor AI Connection");
    expect(html).not.toContain("browser companion");
  });
});
