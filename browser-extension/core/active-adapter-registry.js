(function installCharacterArchiveActiveAdapterRegistry(root) {
  "use strict";

  const adapters = new Map();

  function register(adapter) {
    if (
      !adapter || typeof adapter !== "object" || typeof adapter.platform !== "string" || !adapter.platform ||
      !Number.isSafeInteger(adapter.contractVersion) || adapter.contractVersion < 1 ||
      !Array.isArray(adapter.allowedOrigins) || typeof adapter.matchesPage !== "function" ||
      (typeof adapter.retrieveCharacter !== "function" && (typeof adapter.discoverProfile !== "function" || typeof adapter.retrieveSelected !== "function")) ||
      typeof adapter.preflightPayload !== "function"
    ) throw new TypeError("Invalid browser-local source adapter.");
    const key = typeof adapter.key === "string" && adapter.key ? adapter.key : adapter.platform;
    if (adapters.has(key)) throw new TypeError(`Duplicate active adapter key: ${key}.`);
    adapters.set(key, Object.freeze(adapter));
  }

  function get(platform) { return adapters.get(platform) ?? null; }
  function resolvePage(value) {
    for (const adapter of adapters.values()) {
      const target = adapter.matchesPage(value);
      if (target) return { adapter, target };
    }
    return null;
  }
  function all() { return [...adapters.values()]; }

  root.CharacterArchiveActiveAdapterRegistry = Object.freeze({ register, get, resolvePage, all });
})(globalThis);
