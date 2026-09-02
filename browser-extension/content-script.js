(function installCharacterArchiveContentBoundary(root) {
  "use strict";

  const contract = root.CharacterArchiveCompanionContract;
  const selected = contract?.matchPage(root.location.href);
  const extensionRuntime = root.chrome?.runtime;
  if (!contract || selected?.targetKind !== "CHARACTER" || typeof selected.externalId !== "string" || typeof extensionRuntime?.sendMessage !== "function" || typeof extensionRuntime?.onMessage?.addListener !== "function") return;

  const OBSERVER_TIMEOUT_MS = 750;
  const ACTIVE_RETRIEVAL_TIMEOUT_MS = 31_000;
  let armNonce = null;
  let completed = false;
  let activeRetrievalInFlight = false;

  function diagnostic(event, reason = null) {
    root.console?.debug?.("[Character Archive Companion]", {
      event,
      platform: selected.platform,
      externalId: selected.externalId,
      ...(reason ? { reason } : {}),
    });
  }

  function observerRoundTrip(request, expectedType, nonceKey, nonce) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (reachable) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timeout);
        root.removeEventListener("message", onObserverMessage);
        resolve(reachable);
      };
      const onObserverMessage = (event) => {
        const value = event.data;
        if (
          event.source !== root || event.origin !== root.location.origin || !value || typeof value !== "object" ||
          Array.isArray(value) || Object.keys(value).length !== 5 || value.channel !== contract.CHANNEL ||
          value.version !== contract.VERSION || value.type !== expectedType || value[nonceKey] !== nonce ||
          !contract.sameTarget(value.target, selected)
        ) return;
        finish(true);
      };
      const timeout = root.setTimeout(() => finish(false), OBSERVER_TIMEOUT_MS);
      root.addEventListener("message", onObserverMessage);
      root.postMessage(request, root.location.origin);
    });
  }

  function probeObserver() {
    const observerNonce = contract.createNonce();
    return observerRoundTrip({ channel: contract.CHANNEL, version: contract.VERSION, type: "OBSERVER_PING", observerNonce, target: selected }, "OBSERVER_READY", "observerNonce", observerNonce);
  }

  function probeActiveRetrieval() {
    const activeNonce = contract.createNonce();
    return observerRoundTrip({ channel: contract.CHANNEL, version: contract.VERSION, type: "ACTIVE_RETRIEVAL_PING", activeNonce, target: selected }, "ACTIVE_RETRIEVAL_READY", "activeNonce", activeNonce);
  }

  function retrieveFromPageContext() {
    const operationNonce = contract.createNonce();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timeout);
        root.removeEventListener("message", onRetrievalMessage);
        resolve(result);
      };
      const onRetrievalMessage = (event) => {
        if (event.source !== root || event.origin !== root.location.origin) return;
        const result = contract.validatePageRetrievalResult(event.data, root.location.href, operationNonce);
        if (result) finish(result);
      };
      const timeout = root.setTimeout(() => finish({ status: "FAILED", code: "RETRIEVAL_TIMEOUT", target: selected }), ACTIVE_RETRIEVAL_TIMEOUT_MS);
      root.addEventListener("message", onRetrievalMessage);
      root.postMessage({ channel: contract.CHANNEL, version: contract.VERSION, type: "RETRIEVE_SELECTED_CHARACTER", operationNonce, target: selected }, root.location.origin);
    });
  }

  async function startActiveRetrieval() {
    try {
      const result = await retrieveFromPageContext();
      if (result.status !== "RETRIEVED") {
        await extensionRuntime.sendMessage({ contractVersion: 1, type: "CONTENT_RETRIEVAL_FAILED", target: selected, code: result.code });
        return;
      }
      const capture = {
        messageId: root.crypto.randomUUID(),
        capturedAt: new Date().toISOString(),
        target: selected,
        observerContractVersion: result.observerContractVersion,
        payload: result.payload,
      };
      const response = await extensionRuntime.sendMessage({ contractVersion: 1, type: "CONTENT_CAPTURE", capture });
      if (response?.ok === false) diagnostic("CAPTURE_REJECTED", response.code ?? "BACKGROUND_REJECTED");
      else completed = true;
    } catch {
      try { await extensionRuntime.sendMessage({ contractVersion: 1, type: "CONTENT_RETRIEVAL_FAILED", target: selected, code: "SOURCE_UNAVAILABLE" }); } catch { /* Extension context unavailable. */ }
    } finally {
      activeRetrievalInFlight = false;
    }
  }

  async function armObserver() {
    if (completed) return false;
    const nextArmNonce = contract.createNonce();
    const armed = await observerRoundTrip({ channel: contract.CHANNEL, version: contract.VERSION, type: "ARM_SELECTED_TARGET", armNonce: nextArmNonce, target: selected }, "OBSERVER_ARMED", "armNonce", nextArmNonce);
    armNonce = armed ? nextArmNonce : null;
    return armed;
  }

  async function announceReady() {
    try {
      const response = await extensionRuntime.sendMessage({ contractVersion: 1, type: "CONTENT_READY", target: selected });
      if (response?.arm === true && contract.sameTarget(response.target, selected)) {
        const armed = await armObserver();
        if (armed) await extensionRuntime.sendMessage({ contractVersion: 1, type: "CONTENT_ARMED", target: selected });
      }
    } catch {
      // Extension reload/disconnect leaves the page untouched.
    }
  }

  async function onPageMessage(event) {
    if (completed || !armNonce || event.source !== root || event.origin !== root.location.origin) return;
    const capture = contract.validatePageCaptureMessage(event.data, root.location.href, armNonce);
    if (!capture) {
      if (event.data?.type === "SOURCE_CHARACTER_CAPTURED") diagnostic("CAPTURE_REJECTED", "CONTENT_CONTRACT_REJECTED");
      return;
    }
    completed = true;
    armNonce = null;
    root.removeEventListener("message", onPageMessage);
    try {
      const response = await extensionRuntime.sendMessage({ contractVersion: 1, type: "CONTENT_CAPTURE", capture });
      if (response?.ok === false) diagnostic("CAPTURE_REJECTED", response.code ?? "BACKGROUND_REJECTED");
    } catch {
      // The scoped Archive capability remains in the service worker only.
    }
  }

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && typeof message === "object" && !Array.isArray(message) && Object.keys(message).length === 3 && message.type === "CHARACTER_ARCHIVE_PING" && message.version === 1 && message.targetKind === "CHARACTER") {
      void Promise.all([probeObserver(), probeActiveRetrieval()]).then(([observerReachable, activeRetrievalReachable]) => sendResponse({
        ok: true, version: 1, targetKind: "CHARACTER", target: selected, observerReachable,
        activeRetrievalReachable, observerArmed: Boolean(armNonce),
      }));
      return true;
    }
    if (message && typeof message === "object" && !Array.isArray(message) && Object.keys(message).length === 3 && message.contractVersion === 1 && message.type === "RETRIEVE_SELECTED_CHARACTER" && contract.sameTarget(message.target, selected)) {
      if (completed || activeRetrievalInFlight) {
        sendResponse({ ok: false, version: 1, accepted: false, target: selected, code: "CANCELLED" });
        return undefined;
      }
      activeRetrievalInFlight = true;
      sendResponse({ ok: true, version: 1, accepted: true, target: selected });
      void startActiveRetrieval();
      return undefined;
    }
    if (!message || typeof message !== "object" || Array.isArray(message) || Object.keys(message).length !== 3 || message.contractVersion !== 1 || message.type !== "ARM_SELECTED_TARGET" || !contract.sameTarget(message.target, selected)) return undefined;
    void armObserver().then((armed) => sendResponse(armed
      ? { ok: true, version: 1, armed: true, target: selected, observerReachable: true }
      : { ok: false, version: 1, armed: false, target: selected, observerReachable: false, code: "UNSUPPORTED_CAPTURE_METHOD" }));
    return true;
  });
  root.addEventListener("message", onPageMessage);
  void announceReady();
})(globalThis);
