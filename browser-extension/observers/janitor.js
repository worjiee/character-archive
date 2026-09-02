(function installJanitorSourceObserver(root) {
  "use strict";

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const ALLOWED_ORIGINS = Object.freeze(["https://janitorai.com", "https://www.janitorai.com"]);
  const registry = root.CharacterArchiveObserverRegistry;

  if (!registry || typeof registry.register !== "function") {
    root.console?.debug?.("[Character Archive Companion]", {
      event: "OBSERVER_INITIALIZATION_FAILED",
      code: "SOURCE_CONTRACT_CHANGED",
      platform: "JANITOR_AI",
    });
    return;
  }

  function matchesPage(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || !ALLOWED_ORIGINS.includes(parsed.origin) || parsed.username || parsed.password || parsed.hash) return null;
      const match = /^\/characters\/([0-9a-f-]{36})(?:_[^/?#]*)?\/?$/iu.exec(parsed.pathname);
      if (!match) return null;
      if (!UUID.test(match[1])) return null;
      const externalId = match[1].toLowerCase();
      return Object.freeze({
        targetKind: "CHARACTER",
        platform: "JANITOR_AI",
        externalId,
        canonicalSourceUrl: `https://janitorai.com/characters/${externalId}`,
        pageOrigin: parsed.origin,
      });
    } catch {
      return null;
    }
  }

  function matchesProfilePage(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" || !ALLOWED_ORIGINS.includes(parsed.origin) || parsed.username || parsed.password || parsed.hash) return null;
      const match = /^\/profiles\/([0-9a-fA-F-]{36})(?:_profile-of-[a-z0-9]+(?:-[a-z0-9]+)*)?\/?$/u.exec(parsed.pathname);
      if (!match || !UUID.test(match[1])) return null;
      const profileId = match[1].toLowerCase();
      return Object.freeze({ targetKind: "PROFILE", platform: "JANITOR_AI", profileId, canonicalProfileUrl: `https://janitorai.com/profiles/${profileId}`, pageOrigin: parsed.origin });
    } catch { return null; }
  }

  function matchesObservedResponse(metadata, selected) {
    if (typeof selected?.externalId !== "string") return false;
    if (!metadata || metadata.method !== "GET" || metadata.status < 200 || metadata.status >= 300) return false;
    if (!ALLOWED_ORIGINS.includes(metadata.origin)) return false;
    const match = /^\/hampter\/characters\/([0-9a-f-]{36})\/?$/iu.exec(metadata.pathname);
    return Boolean(match && UUID.test(match[1]) && match[1].toLowerCase() === selected.externalId);
  }

  async function extractCandidatePayload(responseClone) { return responseClone.json(); }
  function preflightPayload(payload, selected) {
    if (typeof selected?.externalId !== "string") return false;
    return Boolean(
      payload && typeof payload === "object" && !Array.isArray(payload) &&
      typeof payload.id === "string" && payload.id.toLowerCase() === selected.externalId &&
      typeof payload.name === "string" && payload.name.trim()
    );
  }

  registry.register({
    platform: "JANITOR_AI",
    contractVersion: 1,
    allowedOrigins: ALLOWED_ORIGINS,
    matchesPage,
    matchesProfilePage,
    matchesObservedResponse,
    extractCandidatePayload,
    preflightPayload,
  });
})(globalThis);
