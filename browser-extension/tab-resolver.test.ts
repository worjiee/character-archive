import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

describe("companion normal-window tab resolver", () => {
  it("resolves the active tab from the last-focused normal browser window", async () => {
    const getLastFocusedWindow = vi.fn(async () => ({ id: 42, type: "normal" }));
    const queryTabs = vi.fn(async () => [{
      id: 7,
      windowId: 42,
      active: true,
      url: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron",
    }]);
    const resolver = loadResolver({ getLastFocusedWindow, queryTabs });

    await expect(resolver.resolveActive()).resolves.toMatchObject({
      tab: { id: 7, windowId: 42, active: true },
      queryResultCount: 1,
      windowId: 42,
    });
    expect(getLastFocusedWindow).toHaveBeenCalledWith({ windowTypes: ["normal"] });
    expect(queryTabs).toHaveBeenCalledWith({ active: true, windowId: 42 });
  });

  it("reports zero results without treating an extension popup as a browser tab", async () => {
    const resolver = loadResolver({
      getLastFocusedWindow: async () => ({ id: 42, type: "normal" }),
      queryTabs: async () => [],
    });

    await expect(resolver.resolveActive()).resolves.toEqual({
      tab: null,
      queryResultCount: 0,
      windowId: 42,
    });
  });

  it("resolves an explicitly bound tab by ID and safely handles a stale ID", async () => {
    const getTabById = vi.fn(async (tabId: number) => {
      if (tabId === 7) return { id: 7, windowId: 42, active: false };
      throw new Error("No tab with id");
    });
    const resolver = loadResolver({ getTabById });

    await expect(resolver.resolveBound(7)).resolves.toEqual({ id: 7, windowId: 42, active: false });
    await expect(resolver.resolveBound(8)).resolves.toBeNull();
  });
});

function loadResolver(overrides: {
  getLastFocusedWindow?: (options: unknown) => Promise<unknown>;
  queryTabs?: (query: unknown) => Promise<unknown[]>;
  getTabById?: (tabId: number) => Promise<unknown>;
}) {
  const context: Record<string, unknown> = {};
  runInNewContext(readFileSync(resolve(process.cwd(), "browser-extension/lib/tab-resolver.js"), "utf8"), context);
  const catalog = context.CharacterArchiveCompanionTabs as {
    createTabResolver(options: Record<string, unknown>): {
      resolveActive(): Promise<Record<string, unknown>>;
      resolveBound(tabId: number): Promise<Record<string, unknown> | null>;
    };
  };
  return catalog.createTabResolver({
    getLastFocusedWindow: overrides.getLastFocusedWindow ?? (async () => ({ id: 42, type: "normal" })),
    queryTabs: overrides.queryTabs ?? (async () => []),
    getTabById: overrides.getTabById ?? (async () => null),
  });
}
