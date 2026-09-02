(function installProfileRetrievalHarness(root) {
  "use strict";
  function createProfileRetrievalHarness({ page = root, contract, registry }) {
    const resolved = registry?.resolvePage?.(page.location.href); if (!resolved || resolved.target?.targetKind !== "PROFILE" || typeof resolved.target.profileId !== "string" || typeof resolved.adapter?.discoverProfile !== "function") return null;
    const { adapter, target } = resolved; let busy = false;
    function post(value) { page.postMessage({ channel: contract.CHANNEL, version: contract.VERSION, target, ...value }, page.location.origin); }
    function onMessage(event) {
      if (event.source !== page || event.origin !== page.location.origin || !event.data || event.data.channel !== contract.CHANNEL || !contract.sameTarget(event.data.target, target)) return;
      const value = event.data;
      if (value.type === "PROFILE_RETRIEVAL_PING" && /^[0-9a-f]{32}$/u.test(value.nonce)) { post({ type: "PROFILE_RETRIEVAL_READY", nonce: value.nonce }); return; }
      if (value.type === "DISCOVER_PROFILE_CHARACTERS" && /^[0-9a-f]{32}$/u.test(value.nonce) && !busy) {
        busy = true; void adapter.discoverProfile(target).then((result) => post({ type: "PROFILE_DISCOVERY_RESULT", nonce: value.nonce, result })).catch(() => post({ type: "PROFILE_DISCOVERY_RESULT", nonce: value.nonce, result: { status: "FAILED", code: "SOURCE_UNAVAILABLE" } })).finally(() => { busy = false; }); return;
      }
      if ((value.type === "DISCOVER_PROFILE_CHARACTERS" || value.type === "RETRIEVE_PROFILE_SELECTED") && /^[0-9a-f]{32}$/u.test(value.nonce) && busy) {
        post({ type: value.type === "DISCOVER_PROFILE_CHARACTERS" ? "PROFILE_DISCOVERY_RESULT" : "PROFILE_RETRIEVAL_COMPLETE", nonce: value.nonce, result: { status: "FAILED", code: "CANCELLED" } });
        return;
      }
      if (value.type === "RETRIEVE_PROFILE_SELECTED" && /^[0-9a-f]{32}$/u.test(value.nonce) && Array.isArray(value.selectedIds) && !busy) {
        busy = true; void adapter.retrieveSelected(target, value.selectedIds, async (externalId, result) => post({ type: "PROFILE_DETAIL_RESULT", nonce: value.nonce, externalId, result })).then((result) => post({ type: "PROFILE_RETRIEVAL_COMPLETE", nonce: value.nonce, result })).catch(() => post({ type: "PROFILE_RETRIEVAL_COMPLETE", nonce: value.nonce, result: { status: "FAILED", code: "SOURCE_UNAVAILABLE" } })).finally(() => { busy = false; }); return;
      }
      if (value.type === "CANCEL_PROFILE_RETRIEVAL") adapter.cancel();
    }
    page.addEventListener("message", onMessage); return Object.freeze({ target, dispose: () => page.removeEventListener("message", onMessage) });
  }
  root.CharacterArchiveProfileRetrievalHarness = Object.freeze({ createProfileRetrievalHarness });
})(globalThis);
