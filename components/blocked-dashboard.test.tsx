import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  BlockedCreatorsManagement,
  BlockRulesManagement,
  ModerationOverview,
  QuarantineManagement,
} from "./blocked-dashboard";
import {
  legacyModerationDestination,
  moderationNavigation,
  ModerationShell,
} from "./moderation-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

describe("moderation route presentation", () => {
  it("exposes four canonical focused destinations and exact active state", () => {
    expect(moderationNavigation.map(({ href }) => href)).toEqual([
      "/blocked",
      "/blocked/quarantine",
      "/blocked/rules",
      "/blocked/creators",
    ]);
    const html = renderToStaticMarkup(
      <ModerationShell active="rules" title="Block Rules" description="Rules">
        <div />
      </ModerationShell>,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/<a[^>]*aria-current="page"[^>]*href="\/blocked\/rules"/);
  });

  it("maps only legacy overview fragments to canonical routes", () => {
    expect(legacyModerationDestination("/blocked", "#quarantine")).toBe("/blocked/quarantine");
    expect(legacyModerationDestination("/blocked", "#block-rules")).toBe("/blocked/rules");
    expect(legacyModerationDestination("/blocked", "#blocked-creators")).toBe("/blocked/creators");
    expect(legacyModerationDestination("/blocked", "")).toBeNull();
    expect(legacyModerationDestination("/blocked/quarantine", "#quarantine")).toBeNull();
  });

  it("renders overview counts and focused actions from existing data", () => {
    const html = renderToStaticMarkup(createElement(ModerationOverview, {
      data: {
        quarantinedCharacters: 2,
        activeBlockRules: 3,
        disabledBlockRules: 4,
        enabledBlockedCreators: 5,
        disabledBlockedCreators: 6,
      },
    }));
    for (const action of ["Review Quarantine", "Manage Block Rules", "Manage Blocked Creators"]) expect(html).toContain(action);
    expect(html).toContain("4 disabled");
    expect(html).toContain("6 disabled");
  });

  it("keeps each management tool focused on its own page", () => {
    const ruleHtml = renderToStaticMarkup(createElement(BlockRulesManagement, {
      data: { rules: [
        { id: "keyword", type: "KEYWORD", value: "spoiler", enabled: true, createdAt: "2026-09-06T00:00:00.000Z" },
        { id: "creator", type: "CREATOR_ID", value: "creator-1", enabled: false, createdAt: "2026-09-06T00:00:00.000Z" },
      ] },
    }));
    expect(ruleHtml).toContain("Creator rules");
    expect(ruleHtml).toContain("Add deterministic rule");
    expect(ruleHtml).not.toContain("Block a creator");
    expect(ruleHtml).not.toContain("Permanently block");

    const creatorHtml = renderToStaticMarkup(createElement(BlockedCreatorsManagement, {
      data: { blockedCreators: [] },
    }));
    expect(creatorHtml).toContain("Block a creator");
    expect(creatorHtml).not.toContain("Add deterministic rule");

    const quarantineHtml = renderToStaticMarkup(createElement(QuarantineManagement, {
      data: { quarantinedCharacters: [] },
    }));
    expect(quarantineHtml).toContain("No characters are currently quarantined");
    expect(quarantineHtml).not.toContain("Add deterministic rule");
    expect(quarantineHtml).not.toContain("Block a creator");
  });
});
