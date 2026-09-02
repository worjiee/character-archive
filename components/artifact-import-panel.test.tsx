import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FallbackReviewDetail } from "@/src/lib/importers/fallback-review";
import type { ImportPreview } from "@/src/lib/importers/workflow";
import {
  applyMappedFallbackItem,
  artifactBatchCounts,
  FallbackReviewDialog,
  selectReadyArtifactFilenames,
  type ArtifactItem,
} from "./artifact-import-panel";

describe("extractor fallback review UI state", () => {
  it("updates a realistic 79 + 4 batch without re-uploading and selects every mapped preview", () => {
    let items: ArtifactItem[] = [
      ...Array.from({ length: 79 }, (_, index) => ({ filename: `ready-${index}.png`, status: "READY" as const, previewJobId: `ready-job-${index}`, preview: preview(`Ready ${index}`) })),
      ...Array.from({ length: 4 }, (_, index) => ({
        filename: `fallback-${index}.txt`, status: "FALLBACK_REVIEW_REQUIRED" as const,
        fallbackReview: {
          reviewId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          expiresAt: "2026-09-01T01:00:00.000Z", displayName: `Fallback ${index}`, exportIndex: 80 + index,
          sourcePlatform: "OTHER" as const, definitionHidden: null, creatorName: null, tagCount: 0,
          artifacts: { txt: true as const, png: true, worldInfoFiles: 0 },
        },
      })),
    ];
    expect(artifactBatchCounts(items)).toEqual({ ready: 79, needsAttention: 4 });

    items = applyMappedFallbackItem(items, "fallback-0.txt", created("mapped-0", "Mapped 0"));
    expect(artifactBatchCounts(items)).toEqual({ ready: 80, needsAttention: 3 });
    for (let index = 1; index < 4; index++) items = applyMappedFallbackItem(items, `fallback-${index}.txt`, created(`mapped-${index}`, `Mapped ${index}`));
    expect(artifactBatchCounts(items)).toEqual({ ready: 83, needsAttention: 0 });
    expect(selectReadyArtifactFilenames(items).size).toBe(83);
  });

  it("renders a keyboard-accessible bounded mapping dialog with friendly metadata and no HTML execution", () => {
    const detail: FallbackReviewDetail = {
      reviewId: "review-123",
      expiresAt: "2026-09-01T01:00:00.000Z",
      displayName: "Thank You for 20k!",
      exportIndex: 59,
      sourcePlatform: "JANITOR_AI",
      definitionHidden: true,
      creatorName: "Creator",
      tagCount: 1,
      artifacts: { txt: true, png: true, worldInfoFiles: 1 },
      artwork: {
        available: true,
        url: "/api/import/artifacts/reviews/review-123/artwork",
        sha256: "a".repeat(64),
        mediaType: "image/png",
        byteLength: 100,
        width: 1,
        height: 1,
      },
      filename: "059_Thank You for 20k!_64bb3dfa.txt",
      prefill: {
        name: "Thank You for 20k!", description: "Partial", personality: null, scenario: null,
        firstGreeting: "", alternateGreetings: [], exampleDialogs: null, creatorName: "Creator", tags: ["#Fantasy"],
      },
      referenceSections: [{ title: "RECONSTRUCTED CARD", content: "<script>alert(1)</script> reference" }],
      lorebooks: [{ title: "World", entryCount: 1, entries: [{ id: "0", keys: ["world"], preview: "Lore preview" }] }],
    };
    const html = renderToStaticMarkup(<FallbackReviewDialog filename={detail.filename} summary={detail} initialDetail={detail} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(html).toContain("Fallback character review");
    expect(html).toContain("Thank You for 20k!");
    expect(html).toContain("Source definition was hidden");
    expect(html).toContain("Supplied fallback text");
    expect(html).toContain("Canonical character fields");
    expect(html).toContain("First greeting");
    expect(html).toContain("Example dialogue");
    expect(html).toContain("Create preview");
    expect(html).toContain('src="/api/import/artifacts/reviews/review-123/artwork"');
    expect(html).toContain('alt="Prepared character artwork"');
    expect(html).toContain('aria-label="Close fallback review"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});

function created(id: string, name: string) {
  return { previewJobId: id, expiresAt: "2026-09-01T00:15:00.000Z", preview: preview(name) };
}

function preview(name: string): ImportPreview {
  return {
    externalId: name, platform: "OTHER", sourceUrl: `urn:test:${name}`, name,
    description: null, personality: null, scenario: null, avatarUrl: null,
    creator: { externalId: null, name: null }, greetings: [], tags: [], lorebookReferences: [],
    provider: "artifact-upload",
  };
}
