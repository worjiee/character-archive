(function installCharacterArchiveTabResolver(root) {
  "use strict";

  function createTabResolver({ getLastFocusedWindow, queryTabs, getTabById }) {
    async function resolveActive() {
      const browserWindow = await getLastFocusedWindow({ windowTypes: ["normal"] });
      if (!browserWindow || typeof browserWindow.id !== "number") {
        return { tab: null, queryResultCount: 0, windowId: null };
      }
      const tabs = await queryTabs({ active: true, windowId: browserWindow.id });
      const results = Array.isArray(tabs) ? tabs : [];
      return {
        tab: results[0] ?? null,
        queryResultCount: results.length,
        windowId: browserWindow.id,
      };
    }

    async function resolveBound(tabId) {
      if (typeof tabId !== "number") return null;
      try {
        return await getTabById(tabId);
      } catch {
        return null;
      }
    }

    return Object.freeze({ resolveActive, resolveBound });
  }

  root.CharacterArchiveCompanionTabs = Object.freeze({ createTabResolver });
})(globalThis);
