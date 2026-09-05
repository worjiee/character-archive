import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FreshCharacterItem } from "@/src/lib/home/fresh";
import { relativeActivityLabel } from "../src/lib/home/relative-activity";
import { createLiveTimeStore } from "../src/lib/home/live-time";
import { FreshCharacterFeed, FreshCharacterRow } from "./fresh-character-feed";

describe("Fresh character row", () => {
  it("uses one accessible button to open the correct quick-view character", () => {
    const onOpen = vi.fn();
    const trigger = {} as HTMLButtonElement;
    const element = FreshCharacterRow({ character: character(), now: NOW, onOpen }) as ReactElement<{
      type: string;
      "aria-haspopup": string;
      onClick: (event: { currentTarget: HTMLButtonElement }) => void;
    }>;

    expect(element.type).toBe("button");
    expect(element.props.type).toBe("button");
    expect(element.props["aria-haspopup"]).toBe("dialog");
    element.props.onClick({ currentTarget: trigger });
    expect(onOpen).toHaveBeenCalledWith("character-1", trigger);
  });

  it("caps visible tags, shows +N, and renders centralized source identity", () => {
    const html = renderToStaticMarkup(<FreshCharacterRow character={character()} now={NOW} onOpen={vi.fn()} />);
    expect(html).toContain("J.AI");
    expect(html).toContain("+3");
    expect(html).toContain("Author");
    expect(html).toContain("Creator");
    expect(html).toContain("Added by Archive Admin");
    expect(html).toContain("First published");
    expect(html).not.toMatch(/spotted|score|message count|buzz/iu);
  });

  it("formats truthful publication-relative timestamps", () => {
    expect(relativeActivityLabel("2026-08-25T12:00:00.000Z", NOW)).toBe("Just now");
    expect(relativeActivityLabel("2026-08-25T11:48:00.000Z", NOW)).toBe("12m ago");
    expect(relativeActivityLabel("2026-08-24T10:00:00.000Z", NOW)).toBe("1d ago");
  });

  it("updates live relative timestamps from Just now -> 1m ago -> 5m ago as fake timers advance while mounted", () => {
    vi.useFakeTimers();
    try {
      const charItem: FreshCharacterItem = {
        ...character(),
        publishedAt: "2026-08-25T11:59:40.000Z", // 20s before NOW
      };
      const store = createLiveTimeStore(NOW, 5_000);
      let html = renderToStaticMarkup(<FreshCharacterFeed characters={[charItem]} now={store.getSnapshot()} />);
      expect(html).toContain("Just now");

      const unsubscribe = store.subscribe(() => {
        html = renderToStaticMarkup(<FreshCharacterFeed characters={[charItem]} now={store.getSnapshot()} />);
      });

      // Advance by 40s (now 60s elapsed -> 1m ago)
      vi.advanceTimersByTime(40_000);
      expect(html).toContain("1m ago");

      // Advance by 4m (now 5m elapsed -> 5m ago)
      vi.advanceTimersByTime(240_000);
      expect(html).toContain("5m ago");

      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});

const NOW = "2026-08-25T12:00:00.000Z";

function character(): FreshCharacterItem {
  return {
    id: "character-1",
    name: "Theron",
    description: "A concise synthetic description.",
    avatarUrl: null,
    status: "ACTIVE",
    publishedAt: "2026-08-25T11:48:00.000Z",
    uploaderName: "Archive Admin",
    sources: [{ platform: "JANITOR_AI", creatorName: "Creator" }],
    tags: [
      { name: "Fantasy", slug: "fantasy" },
      { name: "Romance", slug: "romance" },
      { name: "Adventure", slug: "adventure" },
      { name: "Roleplay", slug: "roleplay" },
      { name: "Male", slug: "male" },
    ],
    tagCount: 8,
  };
}
