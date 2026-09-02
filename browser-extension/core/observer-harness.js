(function installCharacterArchiveObserverHarness(root) {
  "use strict";

  function createObserverHarness({ page = root, contract, registry, now = () => new Date().toISOString() }) {
    if (
      !registry || typeof registry.resolvePage !== "function" ||
      !contract || typeof contract.sameTarget !== "function" || typeof contract.validateArmMessage !== "function"
    ) {
      page.console?.debug?.("[Character Archive Companion]", {
        event: "OBSERVER_INITIALIZATION_FAILED",
        code: "SOURCE_CONTRACT_CHANGED",
      });
      return null;
    }
    const resolved = registry.resolvePage(page.location.href);
    if (!resolved || typeof page.fetch !== "function") return null;
    const { observer, target } = resolved;
    const nativeFetch = page.fetch;
    let armedNonce = null;
    let captureInFlight = false;
    let completed = false;

    function diagnostic(event, details = {}) {
      page.console?.debug?.("[Character Archive Companion]", { event, platform: target.platform, externalId: target.externalId, ...details });
    }
    function dispose() {
      if (page.fetch === observedFetch) page.fetch = nativeFetch;
      page.removeEventListener("message", onControlMessage);
      armedNonce = null;
      captureInFlight = false;
      completed = true;
    }
    function onControlMessage(event) {
      if (completed || event.source !== page || event.origin !== page.location.origin) return;
      const value = event.data;
      if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 5 &&
        value.channel === contract.CHANNEL && value.version === contract.VERSION && value.type === "OBSERVER_PING" &&
        typeof value.observerNonce === "string" && /^[0-9a-f]{32}$/u.test(value.observerNonce) && contract.sameTarget(value.target, target)) {
        page.postMessage({ channel: contract.CHANNEL, version: contract.VERSION, type: "OBSERVER_READY", observerNonce: value.observerNonce, target }, page.location.origin);
        return;
      }
      const arm = contract.validateArmMessage(value, target);
      if (!arm) return;
      armedNonce = arm.armNonce;
      diagnostic("OBSERVER_ARMED");
      page.postMessage({ channel: contract.CHANNEL, version: contract.VERSION, type: "OBSERVER_ARMED", armNonce: armedNonce, target }, page.location.origin);
    }
    async function observedFetch(input, init) {
      const response = await Reflect.apply(nativeFetch, this, arguments);
      if (completed || !armedNonce || captureInFlight) return response;
      const metadata = safeResponseMetadata(input, init, response, page.location.href);
      if (!observer.matchesObservedResponse(metadata, target)) return response;
      captureInFlight = true;
      void captureResponse(response.clone());
      return response;
    }
    async function captureResponse(responseClone) {
      try {
        const payload = await observer.extractCandidatePayload(responseClone, target);
        if (!observer.preflightPayload(payload, target)) {
          diagnostic("CAPTURE_REJECTED", { reason: "SOURCE_PREFLIGHT_REJECTED" });
          captureInFlight = false;
          return;
        }
        page.postMessage({
          channel: contract.CHANNEL,
          version: contract.VERSION,
          type: "SOURCE_CHARACTER_CAPTURED",
          armNonce: armedNonce,
          messageId: page.crypto.randomUUID(),
          capturedAt: now(),
          target,
          observerContractVersion: observer.contractVersion,
          payload,
        }, page.location.origin);
        diagnostic("CAPTURED");
        dispose();
      } catch {
        diagnostic("CAPTURE_REJECTED", { reason: "RESPONSE_PAYLOAD_INVALID" });
        captureInFlight = false;
      }
    }

    page.addEventListener("message", onControlMessage);
    page.fetch = observedFetch;
    diagnostic("OBSERVER_INSTALLED");
    return Object.freeze({ target, dispose });
  }

  function safeResponseMetadata(input, init, response, baseUrl) {
    const method = typeof init?.method === "string" ? init.method : input && typeof input === "object" && typeof input.method === "string" ? input.method : "GET";
    const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input && typeof input === "object" && typeof input.url === "string" ? input.url : "";
    try {
      const parsed = new URL(requestUrl, baseUrl);
      return Object.freeze({ method: method.toUpperCase(), origin: parsed.origin, hostname: parsed.hostname, pathname: parsed.pathname, status: typeof response?.status === "number" ? response.status : 0 });
    } catch { return null; }
  }

  root.CharacterArchiveObserverHarness = Object.freeze({ createObserverHarness, safeResponseMetadata });
})(globalThis);
