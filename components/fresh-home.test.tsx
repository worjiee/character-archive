import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FreshPageData } from "@/src/lib/home/fresh";
import { FreshHome, RecentActivityRail } from "./fresh-home";

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
