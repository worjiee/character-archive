(function installProfileContentBoundary(root) {
  "use strict";
  const contract = root.CharacterArchiveCompanionContract; const target = contract?.matchPage?.(root.location.href); const runtime = root.chrome?.runtime;
  if (!contract || target?.targetKind !== "PROFILE" || typeof target.profileId !== "string" || !runtime?.onMessage?.addListener || !runtime?.sendMessage) return;
  const documentNonce = contract.createNonce();
  let activeNonce = null;
  const MAIN_PROBE_RESULTS = new Set(["MAIN_READY", "MAIN_MISSING", "MAIN_TARGET_MISMATCH", "MAIN_CONTRACT_MISMATCH", "MAIN_TIMEOUT"]);
  function roundTrip(request, terminalTypes, timeoutMs, onProgress) {
    return new Promise((resolve) => {
      let settled = false; const finish = (value) => { if (settled) return; settled = true; root.clearTimeout(timer); root.removeEventListener("message", listener); resolve(value); };
      const listener = (event) => { const value = event.data; if (event.source !== root || event.origin !== root.location.origin || !value || value.channel !== contract.CHANNEL || value.version !== 1 || value.nonce !== request.nonce || !contract.sameTarget(value.target, target)) return; if (terminalTypes.includes(value.type)) finish(value); else onProgress?.(value); };
      const timer = root.setTimeout(() => finish({ type: "PROFILE_RETRIEVAL_FAILED", result: { status: "FAILED", code: "RETRIEVAL_TIMEOUT" } }), timeoutMs);
      root.addEventListener("message", listener); root.postMessage(request, root.location.origin);
    });
  }
  async function discover() {
    const nonce = contract.createNonce(); activeNonce = nonce;
    const value = await roundTrip({ channel: contract.CHANNEL, version: 1, type: "DISCOVER_PROFILE_CHARACTERS", nonce, target }, ["PROFILE_DISCOVERY_RESULT"], 120000);
    activeNonce = null; await runtime.sendMessage({ contractVersion: 1, type: "CONTENT_PROFILE_DISCOVERY", target, result: validateDiscoveryResult(value.result) });
  }
  async function retrieve(selectedIds) {
    const nonce = contract.createNonce(); activeNonce = nonce;
    const pendingForwards = [];
    const value = await roundTrip({ channel: contract.CHANNEL, version: 1, type: "RETRIEVE_PROFILE_SELECTED", nonce, target, selectedIds }, ["PROFILE_RETRIEVAL_COMPLETE"], 30 * 60 * 1000, (progress) => {
      if (progress.type === "PROFILE_DETAIL_RESULT") pendingForwards.push(runtime.sendMessage({ contractVersion: 1, type: "CONTENT_PROFILE_DETAIL", target, externalId: progress.externalId, result: validateDetailResult(progress.externalId, progress.result) }));
    });
    await Promise.allSettled(pendingForwards);
    activeNonce = null; await runtime.sendMessage({ contractVersion: 1, type: "CONTENT_PROFILE_COMPLETE", target, result: value.result });
  }
  function probeMainHarness() {
    const nonce = contract.createNonce();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (mainProbeResult) => {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        root.removeEventListener("message", listener);
        resolve(MAIN_PROBE_RESULTS.has(mainProbeResult) ? mainProbeResult : "MAIN_CONTRACT_MISMATCH");
      };
      const listener = (event) => {
        const value = event.data;
        if (event.source !== root || event.origin !== root.location.origin || !value || typeof value !== "object" || value.nonce !== nonce) return;
        if (value.channel !== contract.CHANNEL || value.version !== 1 || value.type !== "PROFILE_RETRIEVAL_READY") { finish("MAIN_CONTRACT_MISMATCH"); return; }
        if (!contract.sameTarget(value.target, target)) { finish("MAIN_TARGET_MISMATCH"); return; }
        finish("MAIN_READY");
      };
      const timer = root.setTimeout(() => finish("MAIN_MISSING"), 750);
      root.addEventListener("message", listener);
      root.postMessage({ channel: contract.CHANNEL, version: 1, type: "PROFILE_RETRIEVAL_PING", nonce, target }, root.location.origin);
    });
  }
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && typeof message === "object" && !Array.isArray(message) && Object.keys(message).length === 3 && message.type === "PROFILE_ARCHIVE_PING" && message.version === 1 && message.targetKind === "PROFILE") { void probeMainHarness().then((mainProbeResult) => sendResponse({ ok: true, version: 1, targetKind: "PROFILE", target, documentNonce, receiverAlive: true, mainProbeResult, profileRetrievalReachable: mainProbeResult === "MAIN_READY" })); return true; }
    if (message?.contractVersion === 1 && message.type === "DISCOVER_PROFILE_CHARACTERS" && contract.sameTarget(message.target, target) && !activeNonce) { sendResponse({ ok: true, version: 1, accepted: true, target }); void discover(); return undefined; }
    if (message?.contractVersion === 1 && message.type === "RETRIEVE_PROFILE_SELECTED" && contract.sameTarget(message.target, target) && Array.isArray(message.selectedIds) && !activeNonce) { sendResponse({ ok: true, version: 1, accepted: true, target }); void retrieve(message.selectedIds); return undefined; }
    if (message?.contractVersion === 1 && message.type === "CANCEL_PROFILE_RETRIEVAL" && contract.sameTarget(message.target, target)) { root.postMessage({ channel: contract.CHANNEL, version: 1, type: "CANCEL_PROFILE_RETRIEVAL", target }, root.location.origin); sendResponse({ ok: true }); return undefined; }
    return undefined;
  });
  function validateDiscoveryResult(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || contract.containsForbiddenTransportData(value)) return { status: "FAILED", code: "INVALID_SOURCE_PAYLOAD" };
    if (value.status === "FAILED" && contract.isRetrievalErrorCode(value.code)) return { status: "FAILED", code: value.code };
    if (value.status !== "DISCOVERED" || !Array.isArray(value.items) || value.items.length > 100) return { status: "FAILED", code: "INVALID_SOURCE_PAYLOAD" };
    return { status: "DISCOVERED", items: value.items, reportedTotal: Number.isSafeInteger(value.reportedTotal) ? value.reportedTotal : null, truncated: value.truncated === true };
  }
  function validateDetailResult(externalId, value) {
    if (value?.status === "FAILED" && contract.isRetrievalErrorCode(value.code)) return { status: "FAILED", code: value.code };
    const characterTarget = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId, canonicalSourceUrl: `https://janitorai.com/characters/${externalId}`, pageOrigin: target.pageOrigin };
    const capture = contract.validateForwardedCapture({ messageId: root.crypto.randomUUID(), capturedAt: new Date().toISOString(), target: characterTarget, observerContractVersion: 1, payload: value?.payload }, characterTarget);
    return capture ? { status: "RETRIEVED", payload: capture.payload } : { status: "FAILED", code: "INVALID_SOURCE_PAYLOAD" };
  }
  void runtime.sendMessage({ contractVersion: 1, type: "PROFILE_CONTENT_READY", targetKind: "PROFILE", platform: "JANITOR_AI", documentNonce });
})(globalThis);
