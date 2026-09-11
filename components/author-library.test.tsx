import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuthorCharacterLibrary } from "./author-character-library";
import { AuthorLibrary } from "./author-library";
import { CharacterCollectionsProvider } from "./character-collections-provider";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const identity = { platform: "JANITOR_AI" as const, kind: "EXTERNAL_ID" as const, value: "creator-1" };
const character = { id: "character-1", name: "Theron", avatarUrl: null, status: "ACTIVE" as const, sources: [{ platform: "JANITOR_AI" as const, creatorName: "Creator" }], tags: [{ name: "Fantasy", slug: "fantasy" }] };

describe("authors redesign", () => {
  it("renders searchable URL-backed directory controls, truthful source states, tags, and publication activity", () => {
    const html = renderToStaticMarkup(<AuthorLibrary filters={{ query: "", source: "ALL", sort: "name-asc", favoriteOnly: false, page: 1, pageSize: 30 }} browse={{ items: [{ identity, creatorName: "Creator", characterCount: 1, latestPublishedAt: new Date("2026-08-20"), tagPreview: [{ label: "#Fantasy", slug: "fantasy", count: 1 }], isFavorited: false, favoriteProvenance: [] }], pagination: { page: 1, pageSize: 30, hasPrevious: false, hasNext: false } }} />);
    expect(html).toContain("Search creator name");
    expect(html).toContain("Author source");
    expect(html).toContain("Janny · Soon");
    expect(html).toContain("disabled");
    expect(html).toContain("#Fantasy");
    expect(html).toContain("Published Aug 20, 2026");
    expect(html).toContain("/authors/JANITOR_AI/id~creator-1");
  });

  it("renders author-scoped tag search, ANY semantics, page selection, and real Cart action", () => {
    const html = renderToStaticMarkup(<CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}><AuthorCharacterLibrary author={identity} browse={{ items: [character], pagination: { page: 1, pageSize: 30, totalItems: 1, totalPages: 1, hasPrevious: false, hasNext: false } }} filters={{ query: "", tags: ["fantasy"], sort: "published-newest", page: 1, pageSize: 30 }} initialTags={{ items: [{ tagId: "tag-1", slug: "fantasy", canonicalName: "Fantasy", displayLabel: "#Fantasy", count: 1, group: "F" }], page: 1, limit: 30, total: 1, hasMore: false }} selectedTags={[{ slug: "fantasy", label: "#Fantasy" }]} /></CharacterCollectionsProvider>);
    expect(html).toContain("Search this creator’s tags");
    expect(html).toContain("Matches any selected tag");
    expect(html).toContain("#Fantasy ×");
    expect(html).toContain("Select page");
    expect(html).toContain("bulk Cart actions");
    expect(html).toContain('aria-label="Select Theron"');
  });
});
