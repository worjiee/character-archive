import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import CharacterDetailPage from "./page";
import type { CharacterDetail } from "../../../../src/lib/characters/repository";
import { CharacterCollectionsProvider } from "../../../../components/character-collections-provider";

vi.mock("next/server", () => ({
  connection: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

vi.mock("../../../../src/lib/auth", () => ({
  requireUserPageSession: vi.fn().mockResolvedValue({
    id: "usr_member",
    username: "member",
    role: "MEMBER",
  }),
}));

const mockGetCharacterById = vi.fn();
vi.mock("../../../../src/lib/characters/repository", () => ({
  getCharacterById: (...args: unknown[]) => mockGetCharacterById(...args),
}));

function createMockCharacter(overrides: Partial<CharacterDetail> = {}): CharacterDetail {
  return {
    id: "char-sloane",
    name: "Sloane",
    avatarUrl: "https://example.com/sloane.png",
    status: "ACTIVE",
    sources: [
      {
        platform: "JANITOR_AI",
        creatorName: "SEPHA",
        sourceUrl: "https://janitorai.com/characters/55bffb4f",
        addedBy: "Karl",
      },
    ],
    description: "Sloane is a mercenary in Night City.",
    personality: ">PERSONALITY\n- Outward Persona: passionate, headstrong",
    scenario: null,
    exampleDialogs: null,
    blockedReason: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-02T00:00:00Z"),
    publishedAt: new Date("2026-09-01T00:00:00Z"),
    uploaderName: "Karl",
    sourceFields: {
      name: "Sloane",
      description: "Sloane is a mercenary in Night City.",
      personality: ">PERSONALITY\n- Outward Persona: passionate, headstrong",
      scenario: null,
      avatarUrl: "https://example.com/sloane.png",
    },
    hasLocalOverrides: false,
    greetings: [
      {
        id: "greet-1",
        position: 0,
        localPosition: 0,
        hidden: false,
        content: "11:47 PM. Sloane checked the time on her HUD again.",
        source: { platform: "JANITOR_AI", creatorName: "SEPHA" },
      },
      {
        id: "greet-2",
        position: 1,
        localPosition: 1,
        hidden: false,
        content: "Alternative scenario: emergency lighting painted everything red.",
        source: { platform: "JANITOR_AI", creatorName: "SEPHA" },
      },
    ],
    tags: [
      { name: "cyberpunk", slug: "cyberpunk" },
      { name: "FemPov", slug: "fempov" },
    ],
    lorebooks: [],
    ...overrides,
  };
}

function renderPage(element: React.ReactElement) {
  return renderToStaticMarkup(
    <CharacterCollectionsProvider initialState={{ favoriteIds: [], cartIds: [] }} role="MEMBER">
      {element}
    </CharacterCollectionsProvider>,
  );
}

describe("CharacterDetailPage layout and readability", () => {
  it("renders Sloane with dedicated sections for description, personality, multiple greetings, tags, and sources while cleanly omitting scenario and lorebooks", async () => {
    mockGetCharacterById.mockResolvedValueOnce(createMockCharacter());

    const pageElement = await CharacterDetailPage({
      params: Promise.resolve({ id: "char-sloane" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderPage(pageElement);

    // Header & metadata
    expect(html).toContain("Sloane");
    expect(html).toContain("by <span class=\"font-medium text-zinc-200\">SEPHA</span>");
    expect(html).toContain("Character record");
    expect(html).toContain("Updated");
    expect(html).toContain("Sep 2, 2026");

    // DESCRIPTION section rendered with content
    expect(html).toContain("Description");
    expect(html).toContain("Sloane is a mercenary in Night City.");

    // PERSONALITY section rendered with content
    expect(html).toContain("Personality");
    expect(html).toContain("&gt;PERSONALITY\n- Outward Persona: passionate, headstrong");

    // SCENARIO and LOREBOOKS omitted when null/empty
    expect(html).not.toContain("Scenario");
    expect(html).not.toContain("Lorebooks");
    expect(html).not.toContain("Example dialogs");
    expect(html).not.toContain("Not provided.");

    // GREETINGS: multiple greetings rendered with count and default open
    expect(html).toContain("Greetings");
    expect(html).toContain("· 2");
    expect(html).toContain("Default greeting");
    expect(html).toContain("Alternative greeting 1");
    expect(html).toContain("11:47 PM. Sloane checked the time on her HUD again.");

    // TAGS section
    expect(html).toContain("Tags");
    expect(html).toContain("href=\"/characters?tag=cyberpunk\"");
    expect(html).toContain("href=\"/characters?tag=fempov\"");

    // SOURCES section
    expect(html).toContain("Sources");
    expect(html).toContain("https://janitorai.com/characters/55bffb4f");
  });

  it("renders single greeting clearly without accordion when only one greeting exists", async () => {
    mockGetCharacterById.mockResolvedValueOnce(
      createMockCharacter({
        greetings: [
          {
            id: "greet-1",
            position: 0,
            localPosition: 0,
            hidden: false,
            content: "Welcome to the academy.",
            source: { platform: "JANITOR_AI", creatorName: "SEPHA" },
          },
        ],
      }),
    );

    const pageElement = await CharacterDetailPage({
      params: Promise.resolve({ id: "char-single" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderPage(pageElement);

    expect(html).toContain("Greetings");
    expect(html).toContain("Initial greeting");
    expect(html).toContain("Welcome to the academy.");
    expect(html).not.toContain("Alternative greeting");
    expect(html).not.toContain("<details");
  });

  it("renders scenario and lorebooks when character has them", async () => {
    mockGetCharacterById.mockResolvedValueOnce(
      createMockCharacter({
        scenario: "Late night in Night City outskirts.",
        lorebooks: [
          {
            id: "lb-1",
            title: "Night City Underworld",
            description: "Factions and crime syndicates.",
            externalId: "ext-lb-1",
            sourcePlatform: "JANITOR_AI",
            sourceUrl: "https://janitorai.com/lorebooks/1",
            entries: [],
          },
        ],
      }),
    );

    const pageElement = await CharacterDetailPage({
      params: Promise.resolve({ id: "char-with-lorebook" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderPage(pageElement);

    expect(html).toContain("Scenario");
    expect(html).toContain("Late night in Night City outskirts.");
    expect(html).toContain("Lorebooks");
    expect(html).toContain("Night City Underworld");
  });
});
