import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FreshPageData } from "@/src/lib/home/fresh";
import { FreshHome, RecentActivityRail } from "./fresh-home";
import { FreshCharacterFeed } from "./fresh-character-feed";
import { createLiveTimeStore } from "../src/lib/home/live-time";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("Fresh homepage presentation", () => {
  it("renders Fresh, FEED, truthful empty state, and recent activity", () => {
    const html = renderToStaticMarkup(<FreshHome data={data()} />);
    expect(html).toContain("Fresh");
    expect(html).toContain("Feed");
    expect(html).toContain("No archive activity in the last 24 hours.");
    expect(html).toContain("Recent");
    expect(html).toContain("Activity");
    expect(html).toContain("Theron");
    expect(html).toContain("Updated in archive");
    expect(html).not.toMatch(/spotted by|score|msg\/chat|buzz/iu);
  });

  it("server-renders the recent activity rail with its compact relative label", () => {
    const pageData = data();
    const html = renderToStaticMarkup(<RecentActivityRail activity={pageData.activity} now={pageData.generatedAt} />);
    expect(html).toContain("Recent");
    expect(html).toContain("Theron");
    expect(html).toContain(">2m</time>");
    expect(html).not.toContain("2m ago");
  });

  it("updates live relative timestamps in both Fresh feed and Recent Activity rail without page reload", () => {
    vi.useFakeTimers();
    try {
      const pageData: FreshPageData = {
        items: [{
          id: "character-1",
          name: "Fresh Char",
          description: "Description",
          avatarUrl: null,
          status: "ACTIVE",
          publishedAt: "2026-08-25T11:59:40.000Z", // 20s ago
          uploaderName: "Admin",
          sources: [{ platform: "JANITOR_AI", creatorName: "Creator" }],
          tags: [],
          tagCount: 0,
        }],
        activity: [{
          key: "character:1",
          kind: "CHARACTER",
          label: "Fresh Char",
          href: "/characters/1",
          action: "Added to archive",
          occurredAt: "2026-08-25T11:59:40.000Z", // 20s ago
          platform: "JANITOR_AI",
        }],
        generatedAt: "2026-08-25T12:00:00.000Z",
        window: "24h",
        sort: "freshest",
      };

      const store = createLiveTimeStore(pageData.generatedAt, 5_000);
      let feedHtml = renderToStaticMarkup(<FreshCharacterFeed characters={pageData.items} now={store.getSnapshot()} />);
      let sidebarHtml = renderToStaticMarkup(<RecentActivityRail activity={pageData.activity} now={store.getSnapshot()} />);

      // Initially at t = 0: 20s ago -> JUST NOW
      expect(feedHtml).toContain("Just now");
      expect(sidebarHtml).toContain(">Just now</time>");

      // Subscribe (simulating mounted components)
      const unsubscribe = store.subscribe(() => {
        feedHtml = renderToStaticMarkup(<FreshCharacterFeed characters={pageData.items} now={store.getSnapshot()} />);
        sidebarHtml = renderToStaticMarkup(<RecentActivityRail activity={pageData.activity} now={store.getSnapshot()} />);
      });

      // Advance fake timers by 40s (now 60s total -> 1m ago)
      vi.advanceTimersByTime(40_000);
      expect(feedHtml).toContain("1m ago");
      expect(sidebarHtml).toContain(">1m</time>");

      // Advance fake timers by 4 more minutes (240_000ms -> 5m ago)
      vi.advanceTimersByTime(240_000);
      expect(feedHtml).toContain("5m ago");
      expect(sidebarHtml).toContain(">5m</time>");

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});

function data(): FreshPageData {
  return {
    items: [],
    activity: [{
      key: "character:1",
      kind: "CHARACTER",
      label: "Theron",
      href: "/characters/1",
      action: "Updated in archive",
      occurredAt: "2026-08-25T11:58:00.000Z",
      platform: "JANITOR_AI",
    }],
    generatedAt: "2026-08-25T12:00:00.000Z",
    window: "24h",
    sort: "freshest",
  };
}
