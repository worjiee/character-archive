import { describe, expect, it, vi } from "vitest";
import type { InspectedFallbackCandidate } from "./artifacts";
import {
  createFallbackReviewPreview,
  FALLBACK_REVIEW_TTL_MS,
  FallbackReviewStore,
  mapFallbackCharacter,
} from "./fallback-review";
import { toImportPreview } from "./workflow";

const NOW = new Date("2026-09-01T00:00:00.000Z");

describe("session-owned extractor fallback review", () => {
  it("retains a bounded candidate for one hour and exposes only a review summary before inspection", () => {
    const store = new FallbackReviewStore();
    const [summary] = store.registerBatch("session-a", [candidate()], NOW);
    expect(summary).toMatchObject({ displayName: "Private Character", exportIndex: 59, definitionHidden: true, tagCount: 1 });
    expect(summary).not.toHaveProperty("referenceSections");
    expect(store.detail("session-a", summary.reviewId, NOW)).toMatchObject({
      filename: "059_Private Character_d7745ac8.txt",
      referenceSections: [{ title: "RECONSTRUCTED CARD", content: "Reviewer reference only" }],
    });
    expect(new Date(summary.expiresAt).getTime() - NOW.getTime()).toBe(FALLBACK_REVIEW_TTL_MS);
  });

  it("fails closed for forged, cross-user, and expired review identifiers", () => {
    const store = new FallbackReviewStore();
    const [summary] = store.registerBatch("session-a", [candidate()], NOW);
    expect(() => store.detail("session-b", summary.reviewId, NOW)).toThrowError(expect.objectContaining({ code: "REVIEW_NOT_FOUND" }));
    expect(() => store.detail("session-a", "forged", NOW)).toThrowError(expect.objectContaining({ code: "REVIEW_NOT_FOUND" }));
    expect(() => store.detail("session-a", summary.reviewId, new Date(NOW.getTime() + FALLBACK_REVIEW_TTL_MS))).toThrowError(expect.objectContaining({ code: "REVIEW_EXPIRED" }));
  });

  it("maps only reviewer-editable canonical fields while preserving server-bound identity, tags, prose policy, and lorebooks", () => {
    const mapped = mapFallbackCharacter(candidate(), {
      name: "Reviewed Name",
      description: "<p>Readable &amp; safe</p><script>bad()</script>",
      personality: "Patient",
      scenario: "A room",
      firstGreeting: "Hello",
      alternateGreetings: ["Hi"],
      exampleDialogs: "{{char}}: Welcome",
      tags: ["#Fantasy", "fantasy"],
    });
    expect(mapped).toMatchObject({
      platform: "JANITOR_AI",
      externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      name: "Reviewed Name",
      description: "Readable & safe",
      greetings: [{ content: "Hello", position: 0 }, { content: "Hi", position: 1 }],
      tags: [{ name: "#Fantasy", slug: "fantasy" }],
      lorebookReferences: [{ externalId: "artifact-worldinfo-book", title: "Private Character lorebook" }],
    });
    expect(JSON.stringify(mapped)).not.toContain("bad()");
  });

  it("rejects client-supplied identity, uploader, and moderation fields", () => {
    const forged = {
      name: "Reviewed", description: "", personality: "", scenario: "", firstGreeting: "",
      alternateGreetings: [], exampleDialogs: "", tags: [],
      userId: "attacker", uploader: "attacker", moderation: "ACTIVE", platform: "OTHER",
    };
    expect(() => mapFallbackCharacter(candidate(), forged)).toThrowError(expect.objectContaining({ code: "INVALID_MAPPING" }));
  });

  it("creates one immutable preview from the stored candidate and never asks the client to resend fallback text", async () => {
    const store = new FallbackReviewStore();
    const preparedArtwork = {
      sha256: "a".repeat(64), mediaType: "image/png" as const, byteLength: 12, width: 1, height: 1,
      pendingKey: "pending-artwork/1780000000000/aaaaaaaaaaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000000.png",
      expiresAt: "2026-09-01T01:00:00.000Z",
    };
    const [summary] = store.registerBatch("session-a", [{ ...candidate(), preparedArtwork }], NOW);
    const captured = vi.fn();
    const created = await createFallbackReviewPreview("session-a", summary.reviewId, {
      name: "Reviewed", description: "Mapped", personality: "", scenario: "", firstGreeting: "Hello",
      alternateGreetings: [], exampleDialogs: "", tags: ["#Fantasy"],
    }, {
      store,
      now: NOW,
      createPreview: async (_sessionId, character, artwork) => {
        captured(character, artwork);
        return { previewJobId: "preview-job-123456", expiresAt: "2026-09-01T00:15:00.000Z", preview: toImportPreview(character, "artifact-upload") };
      },
    });
    expect(captured).toHaveBeenCalledOnce();
    expect(captured).toHaveBeenCalledWith(expect.objectContaining({ name: "Reviewed" }), preparedArtwork);
    expect(summary.artwork).toMatchObject({
      url: `/api/import/artifacts/reviews/${summary.reviewId}/artwork`,
      sha256: preparedArtwork.sha256,
    });
    expect(created.preview.name).toBe("Reviewed");
    expect(created.preview).not.toHaveProperty("rawData");
    expect(store.detail("session-a", summary.reviewId, NOW).referenceSections[0].content).toBe("Reviewer reference only");
  });
});

function candidate(): InspectedFallbackCandidate {
  return {
    filename: "059_Private Character_d7745ac8.txt",
    displayName: "Private Character",
    exportIndex: 59,
    filenameSuffix: "d7745ac8",
    source: {
      platform: "JANITOR_AI",
      externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
      avatarUrl: null,
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      definitionHidden: true,
    },
    prefill: {
      name: "Private Character",
      description: "Partial description",
      personality: null,
      scenario: null,
      firstGreeting: "",
      alternateGreetings: [],
      exampleDialogs: null,
      creatorName: "Creator",
      tags: ["#Fantasy"],
    },
    referenceSections: [{ title: "RECONSTRUCTED CARD", content: "Reviewer reference only" }],
    lorebooks: [{
      externalId: "artifact-worldinfo-book",
      platform: "JANITOR_AI",
      title: "Private Character lorebook",
      description: null,
      sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7#book",
      entries: [{
        externalEntryId: "0", content: "World entry", keys: ["world"], category: null, enabled: true,
        constant: false, insertionOrder: 0, comment: null, caseSensitive: null, activationMode: null,
        activationScript: null, groupWeight: null, rawData: {},
      }],
      rawData: {},
    }],
    artifacts: { txt: true, png: true, worldInfoFiles: 1 },
    retainedBytes: 1024,
  };
}
