(function installCharacterArchiveActiveRetrievalHarness(root) {
  "use strict";

  function createActiveRetrievalHarness({ page = root, contract, registry }) {
    if (
      !registry || typeof registry.resolvePage !== "function" ||
      !contract || typeof contract.validateRetrievalMessage !== "function" ||
      typeof contract.containsForbiddenTransportData !== "function"
    ) return null;
    const resolved = registry.resolvePage(page.location.href);
    if (!resolved) return null;
    const { adapter, target } = resolved;
    let operationInFlight = false;

    function post(value) { page.postMessage(value, page.location.origin); }
    function onMessage(event) {
      if (event.source !== page || event.origin !== page.location.origin) return;
      const ping = contract.validateActiveRetrievalPing(event.data, target);
      if (ping) {
        post({ channel: contract.CHANNEL, version: contract.VERSION, type: "ACTIVE_RETRIEVAL_READY", activeNonce: ping.activeNonce, target });
        return;
      }
      const request = contract.validateRetrievalMessage(event.data, target);
      if (!request) return;
      if (operationInFlight) {
        postFailure(request.operationNonce, "CANCELLED");
        return;
      }
      operationInFlight = true;
      void adapter.retrieveCharacter(target).then((result) => {
        if (
          result?.status === "RETRIEVED" && adapter.preflightPayload(result.payload, target) &&
          !contract.containsForbiddenTransportData(result.payload) && payloadWithinLimit(result.payload, contract.MAX_CHARACTER_BYTES)
        ) {
          post({
            channel: contract.CHANNEL,
            version: contract.VERSION,
            type: "ACTIVE_RETRIEVAL_RESULT",
            operationNonce: request.operationNonce,
            target,
            status: "RETRIEVED",
            observerContractVersion: adapter.contractVersion,
            payload: result.payload,
          });
          return;
        }
        postFailure(request.operationNonce, contract.isRetrievalErrorCode(result?.code) ? result.code : "INVALID_SOURCE_PAYLOAD");
      }).catch(() => postFailure(request.operationNonce, "SOURCE_UNAVAILABLE")).finally(() => {
        operationInFlight = false;
      });
    }
    function postFailure(operationNonce, code) {
      post({
        channel: contract.CHANNEL,
        version: contract.VERSION,
        type: "ACTIVE_RETRIEVAL_RESULT",
        operationNonce,
        target,
        status: "FAILED",
        code,
      });
    }

    page.addEventListener("message", onMessage);
    return Object.freeze({ target, dispose: () => page.removeEventListener("message", onMessage) });
  }

  function payloadWithinLimit(value, maximum) {
    try { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= maximum; } catch { return false; }
  }

  root.CharacterArchiveActiveRetrievalHarness = Object.freeze({ createActiveRetrievalHarness });
})(globalThis);
