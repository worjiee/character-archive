(function installCharacterArchiveObserverRegistry(root) {
  "use strict";

  const observers = new Map();

  function register(observer) {
    if (
      !observer || typeof observer !== "object" || typeof observer.platform !== "string" || !observer.platform ||
      !Number.isSafeInteger(observer.contractVersion) || observer.contractVersion < 1 ||
      !Array.isArray(observer.allowedOrigins) || typeof observer.matchesPage !== "function" ||
      (observer.matchesProfilePage !== undefined && typeof observer.matchesProfilePage !== "function") ||
      typeof observer.matchesObservedResponse !== "function" ||
      typeof observer.extractCandidatePayload !== "function" || typeof observer.preflightPayload !== "function"
    ) throw new TypeError("Invalid browser source observer.");
    if (observers.has(observer.platform)) throw new TypeError(`Duplicate observer platform: ${observer.platform}.`);
    observers.set(observer.platform, Object.freeze(observer));
  }

  function get(platform) { return observers.get(platform) ?? null; }
  function resolvePage(value) {
    for (const observer of observers.values()) {
      const target = observer.matchesPage(value);
      if (target) return { observer, target };
    }
    return null;
  }
  function resolveTarget(value) {
    const character = resolvePage(value);
    if (character) return { ...character, targetKind: "CHARACTER" };
    for (const observer of observers.values()) {
      const profile = observer.matchesProfilePage?.(value);
      if (profile) return { observer, targetKind: "PROFILE", target: profile };
    }
    return null;
  }
  function all() { return [...observers.values()]; }

  root.CharacterArchiveObserverRegistry = Object.freeze({ register, get, resolvePage, resolveTarget, all });
})(globalThis);
