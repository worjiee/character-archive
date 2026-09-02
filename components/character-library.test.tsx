import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CharacterBrowseFacets, CharacterBrowseInput, CharacterBrowseResult } from "@/src/lib/characters/browse";
import { CharacterCollectionsProvider } from "./character-collections-provider";
import { CharacterLibrary, characterSelectionContextKey } from "./character-library";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

describe("Datacat-aligned character browser", () => {
  it("renders dense truthful filters, search, supported sorts, and page selection", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterLibrary browse={browse} facets={facets} filters={filters()} initialTagSearch={tagSearch} selectedTags={[]} />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain('aria-label="Character filters"');
    expect(html).toContain('aria-controls="character-mobile-filters"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('placeholder="Search characters or creators"');
    expect(html).toContain('type="search"');
    expect(html).toContain("Janitor AI");
    expect(html).toContain("Saucepan");
    expect(html).toContain("Datacat");
    expect(html).toContain("Janny");
    expect(html).toContain("Coming soon");
    expect(html).toContain("Matches any selected tag");
    expect(html).toContain('placeholder="Search all tags..."');
    expect(html).toContain('aria-label="Tag source"');
    expect(html).toContain('class="characters-tag-source-options"');
    expect(html).toContain('aria-label="Janny, coming soon"');
    expect(html).toContain("Fantasy");
    expect(html).toContain("Freshest activity");
    expect(html).toContain("Oldest activity");
    expect(html).toContain("Name A–Z");
    expect(html).toContain("Select page");
    expect(html).toContain('aria-label="Select Theron"');
    expect(html).toContain('aria-label="Preview Theron"');
    expect(html).not.toMatch(/Public|Yours/);
  });

  it("renders source raw labels while checking the canonical URL identity", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterLibrary
          browse={browse}
          facets={facets}
          filters={{ ...filters(), tags: ["fantasy"], tagSource: "SAUCEPAN" }}
          initialTagSearch={{
            items: [{ tagId: "tag-fantasy", slug: "fantasy", canonicalName: "Fantasy", displayLabel: "#Fantasy", source: "SAUCEPAN", count: 1, group: "F" }],
            page: 1,
            limit: 50,
            total: 1,
            hasMore: false,
          }}
          selectedTags={[{ slug: "fantasy", label: "Fantasy" }]}
        />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain("#Fantasy");
    expect(html).toContain('aria-label="#Fantasy, 1 characters"');
    expect(html).toContain('checked=""');
    expect(html).toContain("Remove Fantasy filter");
    expect(html).toContain('aria-pressed="true" aria-label="Saucepan"');
  });

  it("keeps an empty tag search separate from character results", () => {
    const html = renderToStaticMarkup(
      <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }}>
        <CharacterLibrary
          browse={browse}
          facets={facets}
          filters={filters()}
          initialTagSearch={{ items: [], page: 1, limit: 50, total: 0, hasMore: false }}
          selectedTags={[]}
        />
      </CharacterCollectionsProvider>,
    );
    expect(html).toContain("No tags found");
    expect(html).toContain("Try another search or source vocabulary.");
    expect(html).toContain('aria-label="Preview Theron"');
  });

  it("changes the selection boundary for filters, sorts, and pagination", () => {
    const base = filters();
    const keys = [
      characterSelectionContextKey(base),
      characterSelectionContextKey({ ...base, query: "Theron" }),
      characterSelectionContextKey({ ...base, sources: ["JANITOR_AI"] }),
      characterSelectionContextKey({ ...base, tags: ["fantasy"] }),
      characterSelectionContextKey({ ...base, sort: "name-asc" }),
      characterSelectionContextKey({ ...base, page: 2 }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

const browse: CharacterBrowseResult = {
  items: [{ id: "character-1", name: "Theron", avatarUrl: "/theron.webp", status: "ACTIVE", sources: [{ platform: "JANITOR_AI", creatorName: "Creator" }], tags: [{ name: "Fantasy", slug: "fantasy" }] }],
  pagination: { page: 1, pageSize: 30, totalItems: 1, totalPages: 1, hasPrevious: false, hasNext: false },
};

const facets: CharacterBrowseFacets = {
  total: 1,
  sources: [
    { value: "JANITOR_AI", label: "Janitor AI", count: 1 },
    { value: "SAUCEPAN", label: "Saucepan", count: 0 },
    { value: "DATACAT", label: "Datacat", count: 0 },
    { value: "OTHER", label: "Other", count: 0 },
  ],
  statuses: [{ value: "ACTIVE", label: "Active", count: 1 }, { value: "QUARANTINED", label: "Quarantined", count: 0 }, { value: "BLOCKED", label: "Blocked", count: 0 }],
};

const tagSearch = {
  items: [
    { tagId: "tag-fantasy", slug: "fantasy", canonicalName: "Fantasy", displayLabel: "Fantasy", source: "ALL" as const, count: 1, group: "F" },
    { tagId: "tag-male", slug: "male", canonicalName: "Male", displayLabel: "Male", source: "ALL" as const, count: 1, group: "M" },
  ],
  page: 1,
  limit: 50,
  total: 2,
  hasMore: false,
};

function filters(): CharacterBrowseInput {
  return { query: "", sources: [], tags: [], tagSource: "ALL", statuses: [], sort: "updated", page: 1, pageSize: 30 };
}
