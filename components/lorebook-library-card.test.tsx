import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LorebookListItem } from "../src/lib/lorebooks/repository";
import { getSourceIdentity } from "../src/lib/sources/presentation";
import { LorebookLibraryCard } from "./lorebook-library-card";

describe("LorebookLibraryCard", () => {
  it("links to the record and renders only truthful card metadata", () => {
    const markup = renderToStaticMarkup(<LorebookLibraryCard lorebook={lorebook()} />);

    expect(markup).toContain('href="/lorebooks/lorebook-1"');
    expect(markup).toContain("Archive Places");
    expect(markup).toContain(">3</strong> entries");
    expect(markup).toContain(">2</strong> characters");
    expect(markup).not.toContain("rawData");
  });

  it("gets its source label from the centralized presentation catalog", () => {
    const markup = renderToStaticMarkup(<LorebookLibraryCard lorebook={lorebook()} />);
    expect(markup).toContain(getSourceIdentity("DATACAT").label);
    expect(markup).not.toContain("Legacy source");
  });
});

function lorebook(): LorebookListItem {
  return {
    id: "lorebook-1",
    externalId: "external-1",
    title: "Archive Places",
    description: "Locations used by the cast.",
    sourcePlatform: "DATACAT",
    sourceUrl: "https://example.com/lorebooks/1",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-10T00:00:00.000Z"),
    lastSyncedAt: null,
    entryCount: 3,
    characterCount: 2,
  };
}
