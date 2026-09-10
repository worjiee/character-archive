import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { analyzeBulkCharacterUrls, type BulkCharacterUrlAnalysis } from "../src/lib/importers/source-url";
import {
  ImportRetrievalPanel,
  selectableBulkUrls,
  switchImportMode,
} from "./import-retrieval-panel";
import { ImportWorkflow } from "./import-workflow";

describe("Add Character retrieval modes", () => {
  it("defaults to one accessible Single URL form with no automatic save", () => {
    const html = renderPanel();
    expect(html).toContain('role="tab" aria-selected="true"');
    expect(html).toContain('id="character-source-url" type="url" required=""');
    expect(html).toContain("Enter character or Janitor profile URL");
    expect(html).toContain('type="submit"');
    expect(html).toContain("Retrieve");
    expect(html).not.toContain("Save to Repository");
  });

  it("renders Bulk as an explicit mode with bounded local review controls", () => {
    const html = renderPanel("bulk");
    expect(html).toContain('aria-selected="true" aria-controls="import-panel-bulk"');
    expect(html).toContain('id="bulk-character-urls"');
    expect(html).toContain("0 valid");
    expect(html).toContain("0 invalid");
    expect(html).toContain("0 duplicates");
    expect(html).toContain("0 / 100 unique entries");
    expect(html).toContain("Review URLs");
    expect(html).not.toContain("Retrieve Selected");
  });

  it("preserves independent Single and Bulk drafts while switching modes", () => {
    const state = { mode: "single" as const, singleUrl: "https://janitorai.com/characters/example", bulkInput: "https://saucepan.ai/companion/example" };
    const bulk = switchImportMode(state, "bulk");
    const single = switchImportMode(bulk, "single");
    expect(single.singleUrl).toBe(state.singleUrl);
    expect(single.bulkInput).toBe(state.bulkInput);
  });

  it("selects only retrieval-capable URLs from the current reviewed batch", () => {
    const analysis = analyzeBulkCharacterUrls("https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character") as BulkCharacterUrlAnalysis;
    expect(selectableBulkUrls(analysis)).toEqual([]);
    const ready = structuredClone(analysis);
    const detection = ready.items[0]?.detection;
    if (detection?.recognized) detection.bulkCapability = "READY";
    expect(selectableBulkUrls(ready)).toEqual([ready.items[0]?.sourceUrl]);
  });

  it("keeps manual JSON, Companion, and experimental connector under collapsed Advanced", () => {
    const html = renderToStaticMarkup(createElement(ImportWorkflow, { automaticFixtureEnabled: false, initialUrl: "" }));
    const advanced = html.match(/<details class="group border-t[^>]*>/)?.[0];
    expect(advanced).toBeDefined();
    expect(advanced).not.toContain("open");
    expect(html).toContain("Manual character data");
    expect(html).toContain("Character Archive Companion");
    expect(html).toContain("Janitor character and bounded profile transfer");
    expect(html).toContain("Experimental server connector");
    expect(html).toContain("Production development paused");
  });

  it("makes ZIP and Character Card PNG upload the production primary path", () => {
    const html = renderToStaticMarkup(createElement(ImportWorkflow, { automaticFixtureEnabled: false, initialUrl: "" }));
    expect(html).toContain("Production import");
    expect(html).toContain("Import extractor ZIP or character card");
    expect(html).toContain('accept=".zip,.png,.json,application/zip,image/png,application/json"');
    expect(html).toContain("Drop a ZIP export, CCv2 PNG, or CCv2 JSON here");
    expect(html).toContain("Maximum archive: 256 MiB");
    expect(html).toContain("Individual Character Card PNG: up to 32 MiB · JSON: up to 2 MiB");
    expect(html).toContain("Alternative imports");
    expect(html).toContain("Browse files");
  });

  it("presents a Janitor profile as an explicit Profile pairing workflow", () => {
    const html = renderToStaticMarkup(createElement(ImportWorkflow, {
      automaticFixtureEnabled: false,
      initialUrl: "https://janitorai.com/profiles/db9561b7-6a39-4923-9452-ba34c0464844_profile-of-darkmountain",
    }));
    expect(html).toContain("Janitor profile detected.");
    expect(html).toContain("Use Pair Profile in the Companion panel below.");
    expect(html).toContain("Profile pairing target");
    expect(html).toContain("Pair Profile");
    expect(html).not.toContain("Pair Companion");
  });
});

function renderPanel(initialMode: "single" | "bulk" = "single") {
  return renderToStaticMarkup(createElement(ImportRetrievalPanel, {
    singleUrl: "",
    onSingleUrlChange: vi.fn(),
    loading: false,
    error: null,
    onRetrieveSingle: vi.fn(),
    initialMode,
  }));
}
