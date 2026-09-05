import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createLiveTimeStore } from "./live-time";
import { relativeActivityLabel } from "./relative-activity";

describe("LiveTimeStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("server snapshot matches initialNow deterministically for hydration", () => {
    const NOW = "2026-08-25T12:00:00.000Z";
    const store = createLiveTimeStore(NOW);
    expect(store.getServerSnapshot()).toBe(NOW);
    expect(store.getSnapshot()).toBe(NOW);
  });

  it("proves JUST NOW -> 1M AGO -> 5M AGO -> 59M AGO -> 1H AGO -> 2H AGO as fake timers advance while remaining mounted without navigation/reload", () => {
    const NOW = "2026-08-25T12:00:00.000Z";
    // Character published 20 seconds before initialNow
    const publishedAt = "2026-08-25T11:59:40.000Z";

    const store = createLiveTimeStore(NOW, 5_000);
    let currentLabel = relativeActivityLabel(publishedAt, store.getSnapshot());

    // Initially 20 seconds ago -> JUST NOW
    expect(currentLabel).toBe("Just now");
    expect(currentLabel.toUpperCase()).toBe("JUST NOW");

    // Component mounts and subscribes to the live time store
    const unsubscribe = store.subscribe(() => {
      currentLabel = relativeActivityLabel(publishedAt, store.getSnapshot());
    });

    // Advance fake timers by 20s (total elapsed: 40s -> still Just now)
    vi.advanceTimersByTime(20_000);
    expect(currentLabel).toBe("Just now");
    expect(currentLabel.toUpperCase()).toBe("JUST NOW");

    // Advance fake timers by 20s more (total elapsed: 60s -> 1m ago / 1M AGO)
    vi.advanceTimersByTime(20_000);
    expect(currentLabel).toBe("1m ago");
    expect(currentLabel.toUpperCase()).toBe("1M AGO");

    // Advance fake timers by 4 more minutes (240_000ms -> total elapsed 5m -> 5m ago / 5M AGO)
    vi.advanceTimersByTime(240_000);
    expect(currentLabel).toBe("5m ago");
    expect(currentLabel.toUpperCase()).toBe("5M AGO");

    // Advance to 59 minutes total (54 more minutes = 3_240_000ms)
    vi.advanceTimersByTime(3_240_000);
    expect(currentLabel).toBe("59m ago");
    expect(currentLabel.toUpperCase()).toBe("59M AGO");

    // Advance 1 more minute to hit 60 minutes total -> 1h ago / 1H AGO
    vi.advanceTimersByTime(60_000);
    expect(currentLabel).toBe("1h ago");
    expect(currentLabel.toUpperCase()).toBe("1H AGO");

    // Advance 1 more hour to hit 2 hours total -> 2h ago / 2H AGO
    vi.advanceTimersByTime(3_600_000);
    expect(currentLabel).toBe("2h ago");
    expect(currentLabel.toUpperCase()).toBe("2H AGO");

    unsubscribe();
  });

  it("shares one single timer across multiple UI subscribers and cleans up on unmount", () => {
    const NOW = "2026-08-25T12:00:00.000Z";
    const store = createLiveTimeStore(NOW, 5_000);

    expect(store.getListenerCount?.()).toBe(0);

    let feedTicks = 0;
    let sidebarTicks = 0;

    // FreshCharacterFeed mounts
    const unsubscribeFeed = store.subscribe(() => {
      feedTicks++;
    });
    expect(store.getListenerCount?.()).toBe(1);

    // RecentActivityRail mounts
    const unsubscribeSidebar = store.subscribe(() => {
      sidebarTicks++;
    });
    expect(store.getListenerCount?.()).toBe(2);

    // Advance 10s (2 ticks of 5s)
    vi.advanceTimersByTime(10_000);
    expect(feedTicks).toBe(2);
    expect(sidebarTicks).toBe(2);

    // Sidebar unmounts
    unsubscribeSidebar();
    expect(store.getListenerCount?.()).toBe(1);

    // Advance another 5s (1 tick)
    vi.advanceTimersByTime(5_000);
    expect(feedTicks).toBe(3);
    expect(sidebarTicks).toBe(2); // no further ticks for unmounted component

    // Feed unmounts (all unmounted)
    unsubscribeFeed();
    expect(store.getListenerCount?.()).toBe(0);

    // Advance another 10s -> zero ticks because timer was cleaned up
    vi.advanceTimersByTime(10_000);
    expect(feedTicks).toBe(3);
  });
});
