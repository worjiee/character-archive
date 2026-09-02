// ==UserScript==
// @name         Character Archive — Janitor Browser Bridge
// @namespace    https://character-archive.local/
// @version      0.2.1
// @description  Development/experimental observer; standard and receiver transports are not supported.
// @match        https://janitorai.com/characters/*
// @match        https://www.janitorai.com/characters/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @sandbox      raw
// @run-at       document-start
// @noframes
// ==/UserScript==

(function bootstrap(root, createHelpers) {
  "use strict";
  const helpers = createHelpers();
  if (typeof module === "object" && module.exports) module.exports = helpers;
  if (!root || !root.document) return;
  const sandboxMode = typeof GM_info === "object" && GM_info !== null
    ? GM_info.sandboxMode
    : null;
  const pageContextAvailable = helpers.isRawPageContext(sandboxMode);
  if (!pageContextAvailable) {
    root.addEventListener(
      "DOMContentLoaded",
      () => installPageContextWarning(sandboxMode),
      { once: true },
    );
    return;
  }
  const selectedCharacterId = helpers.selectedCharacterId(root.location.pathname);
  if (!selectedCharacterId) return;

  // This destination is owner-configured in the companion source, never read from Janitor content.
  const ARCHIVE_ORIGIN = "http://localhost:3000";
  const STATE_KEY = "character-archive-janitor-bridge-v1";
  const nativeFetch = root.fetch;
  const originalFetch = nativeFetch.bind(root);
  let armedState = null;
  let receiverWindow = null;
  let pendingEnvelope = null;
  let observerInstalled = false;
  let captureStarted = false;
  let receiverTimer = null;

  root.addEventListener("message", receiveFromArchive);
  void loadArmedState();
  root.addEventListener("DOMContentLoaded", installControl, { once: true });

  async function loadArmedState() {
    const state = await GM_getValue(STATE_KEY, null);
    if (!helpers.isStoredChannelState(state, Date.now())) {
      if (state) await GM_deleteValue(STATE_KEY);
      return;
    }
    armedState = state;
    installObserver();
  }

  function installObserver() {
    if (!armedState || captureStarted || observerInstalled) return;
    observerInstalled = true;
    root.fetch = async function observedFetch(input, init) {
      const response = await originalFetch(input, init);
      const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
      const method = (init && init.method) || (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
      if (helpers.matchesCharacterResponse({
        requestUrl,
        method,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        selectedId: selectedCharacterId,
      })) {
        captureStarted = true;
        removeObserver();
        void prepareEnvelope(response.clone());
      }
      return response;
    };
  }

  function removeObserver() {
    root.fetch = nativeFetch;
    observerInstalled = false;
  }

  async function prepareEnvelope(clone) {
    if (!armedState) return;
    try {
      const payload = await clone.json();
      if (helpers.containsForbiddenTransportKey(payload)) {
        throw new Error("Credential-shaped source data was rejected.");
      }
      const envelope = {
        bridgeVersion: 1,
        messageId: root.crypto.randomUUID(),
        platform: "JANITOR_AI",
        type: "CHARACTER",
        capturedAt: new Date().toISOString(),
        source: { url: `${root.location.origin}${root.location.pathname}` },
        payload,
      };
      if (new TextEncoder().encode(JSON.stringify(envelope)).byteLength > 2 * 1024 * 1024) {
        throw new Error("The character response is too large for the bridge.");
      }
      pendingEnvelope = envelope;
      if (receiverWindow) sendEnvelope();
      else {
        setControlMessage("Character captured. Waiting for the paired Archive receiver…");
        receiverTimer = root.setTimeout(() => void failAndClear("Archive receiver window was not available."), 10000);
      }
    } catch (error) {
      await failAndClear(error instanceof Error ? error.message : "Bridge transfer failed.");
    }
  }

  function sendEnvelope() {
    if (!receiverWindow || !armedState || !pendingEnvelope) return;
    receiverWindow.postMessage({
      channelVersion: 1,
      type: "CHARACTER_ENVELOPE",
      channelNonce: armedState.channelNonce,
      envelope: pendingEnvelope,
    }, ARCHIVE_ORIGIN);
    pendingEnvelope = null;
    if (receiverTimer !== null) {
      root.clearTimeout(receiverTimer);
      receiverTimer = null;
    }
    setControlMessage("Character sent to the Archive receiver. Waiting for confirmation…");
  }

  function pair() {
    const channelNonce = helpers.createChannelNonce(root.crypto);
    const receiverUrl = helpers.createReceiverUrl(ARCHIVE_ORIGIN, channelNonce);
    receiverWindow = root.open(receiverUrl, `character-archive-bridge-${channelNonce}`, "popup,width=520,height=620");
    if (!receiverWindow) {
      setControlMessage("Archive receiver popup was blocked. Allow this explicit popup and try again.");
      return;
    }
    armedState = { channelNonce, expiresAt: null };
    setControlMessage("Archive receiver opened. Enter the one-time pairing code in that window.");
  }

  function receiveFromArchive(event) {
    const currentNonce = armedState && armedState.channelNonce;
    if (!currentNonce || event.origin !== ARCHIVE_ORIGIN) return;
    const message = helpers.validateArchiveReceiverMessage(event.data, currentNonce);
    if (!message) return;

    if (receiverWindow && event.source !== receiverWindow) return;
    if (!receiverWindow) {
      if (message.type !== "RECEIVER_PAIRED" || !armedState.expiresAt) return;
      receiverWindow = event.source;
    }

    if (message.type === "RECEIVER_READY") {
      receiverWindow.postMessage({
        channelVersion: 1,
        type: "CHANNEL_OPEN",
        channelNonce: currentNonce,
      }, ARCHIVE_ORIGIN);
      return;
    }

    if (message.type === "PAIR_RESULT") {
      if (!message.ok) {
        void failAndClear(helpers.bridgeErrorMessage(message.errorCode));
        return;
      }
      armedState = { channelNonce: currentNonce, expiresAt: message.expiresAt };
      void GM_setValue(STATE_KEY, armedState);
      installObserver();
      setControlMessage("Bridge paired. Reload this character page so Janitor can perform its normal request.");
      return;
    }

    if (message.type === "RECEIVER_PAIRED") {
      if (armedState.expiresAt !== message.expiresAt) return;
      if (pendingEnvelope) sendEnvelope();
      return;
    }

    if (message.type === "IMPORT_RESULT") {
      if (message.ok) {
        void clearState();
        setControlMessage(`Character ${selectedCharacterId} sent. Return to Character Archive to preview.`);
      } else {
        void failAndClear(helpers.bridgeErrorMessage(message.errorCode));
      }
    }
  }

  function installControl() {
    const control = root.document.createElement("div");
    control.id = "character-archive-bridge-control";
    control.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px;border:1px solid #8b7428;border-radius:8px;background:#181713;color:#f5e7a1;font:12px system-ui;box-shadow:0 8px 24px #0008";
    const button = root.document.createElement("button");
    button.type = "button";
    button.textContent = "Send to Character Archive";
    button.style.cssText = "border:0;border-radius:6px;padding:7px 10px;background:#d6b84b;color:#17130a;font-weight:700;cursor:pointer";
    button.addEventListener("click", pair);
    const message = root.document.createElement("div");
    message.id = "character-archive-bridge-message";
    message.style.cssText = "max-width:280px;margin-top:6px;line-height:1.4;color:#d4d4d8";
    message.textContent = armedState
      ? "Bridge armed. Keep the Archive receiver open and reload this page."
      : "Not paired.";
    control.append(button, message);
    root.document.body.append(control);
  }

  function installPageContextWarning(mode) {
    const warning = root.document.createElement("div");
    warning.id = "character-archive-bridge-control";
    warning.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:10px;border:1px solid #b45309;border-radius:8px;background:#181713;color:#fcd34d;font:12px system-ui;box-shadow:0 8px 24px #0008";
    const modeLabel = typeof mode === "string" ? mode : "unknown";
    warning.textContent = `PAGE_CONTEXT_UNAVAILABLE (${modeLabel}) — bridge observation was not installed.`;
    root.document.body.append(warning);
  }

  function setControlMessage(message) {
    const target = root.document.getElementById("character-archive-bridge-message");
    if (target) target.textContent = message;
  }

  async function failAndClear(message) {
    await clearState();
    setControlMessage(message);
  }

  async function clearState() {
    armedState = null;
    pendingEnvelope = null;
    captureStarted = true;
    removeObserver();
    if (receiverTimer !== null) {
      root.clearTimeout(receiverTimer);
      receiverTimer = null;
    }
    await GM_deleteValue(STATE_KEY);
  }
})(typeof window === "undefined" ? null : window, function createHelpers() {
  "use strict";
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
  const CHANNEL_NONCE = /^[0-9a-f]{32}$/;
  const forbidden = new Set(["authorization", "bearer", "bearertoken", "headers", "cookie", "cookies", "setcookie", "accesstoken", "refreshtoken", "session", "sessionid", "sessiontoken", "token", "password", "apikey", "clientsecret", "secretkey", "localstorage", "sessionstorage", "indexeddb", "cloudflare", "cloudflarestate", "cfclearance"]);
  function isRawPageContext(sandboxMode) {
    return sandboxMode === "raw";
  }
  function selectedCharacterId(pathname) {
    const match = pathname.match(new RegExp(`^/characters/(${UUID})(?:_|$)`, "i"));
    return match ? match[1].toLowerCase() : null;
  }
  function matchesCharacterResponse(input) {
    try {
      const url = new URL(input.requestUrl, "https://janitorai.com");
      return input.method.toUpperCase() === "GET"
        && (url.origin === "https://janitorai.com" || url.origin === "https://www.janitorai.com")
        && url.pathname.toLowerCase() === `/hampter/characters/${input.selectedId.toLowerCase()}`
        && input.status >= 200 && input.status < 300
        && (input.contentType.toLowerCase().includes("application/json") || input.contentType.toLowerCase().includes("+json"));
    } catch { return false; }
  }
  function containsForbiddenTransportKey(root) {
    const pending = [root];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== "object") continue;
      if (Array.isArray(value)) { pending.push(...value); continue; }
      for (const [key, child] of Object.entries(value)) {
        const normalized = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");
        if (forbidden.has(normalized)) return true;
        if (child && typeof child === "object") pending.push(child);
      }
    }
    return false;
  }
  function createChannelNonce(cryptoApi) {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  function createReceiverUrl(archiveOrigin, channelNonce) {
    if (!CHANNEL_NONCE.test(channelNonce)) throw new Error("Invalid bridge channel.");
    const origin = new URL(archiveOrigin).origin;
    if (origin !== archiveOrigin) throw new Error("Archive origin must be exact.");
    const receiver = new URL("/bridge/receiver", origin);
    receiver.hash = new URLSearchParams({ channel: channelNonce }).toString();
    return receiver.toString();
  }
  function isStoredChannelState(value, now) {
    return Boolean(value)
      && typeof value === "object"
      && Object.keys(value).length === 2
      && CHANNEL_NONCE.test(value.channelNonce)
      && typeof value.expiresAt === "string"
      && new Date(value.expiresAt).getTime() > now;
  }
  function validateArchiveReceiverMessage(value, channelNonce) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (value.channelVersion !== 1 || value.channelNonce !== channelNonce) return null;
    const keys = Object.keys(value);
    if (value.type === "RECEIVER_READY" && sameKeys(keys, ["channelVersion", "type", "channelNonce"])) {
      return value;
    }
    if (value.type === "RECEIVER_PAIRED" && sameKeys(keys, ["channelVersion", "type", "channelNonce", "expiresAt"]) && validExpiry(value.expiresAt)) {
      return value;
    }
    if (value.type === "PAIR_RESULT" && value.ok === true && sameKeys(keys, ["channelVersion", "type", "channelNonce", "ok", "expiresAt"]) && validExpiry(value.expiresAt)) {
      return value;
    }
    if (value.type === "PAIR_RESULT" && value.ok === false && sameKeys(keys, ["channelVersion", "type", "channelNonce", "ok", "errorCode"]) && validErrorCode(value.errorCode)) {
      return value;
    }
    if (value.type === "IMPORT_RESULT" && value.ok === true && sameKeys(keys, ["channelVersion", "type", "channelNonce", "ok"])) {
      return value;
    }
    if (value.type === "IMPORT_RESULT" && value.ok === false && sameKeys(keys, ["channelVersion", "type", "channelNonce", "ok", "errorCode"]) && validErrorCode(value.errorCode)) {
      return value;
    }
    return null;
  }
  function sameKeys(actual, expected) {
    return actual.length === expected.length && actual.every((key) => expected.includes(key));
  }
  function validExpiry(value) {
    return typeof value === "string" && Number.isFinite(new Date(value).getTime());
  }
  function validErrorCode(value) {
    return typeof value === "string" && /^[A-Z0-9_]{2,64}$/.test(value);
  }
  function bridgeErrorMessage(code) {
    if (code === "PAIRING_EXPIRED") return "Pairing expired. Create a new code in Character Archive.";
    if (code === "INVALID_PAIRING") return "Invalid pairing code.";
    if (code === "BRIDGE_SESSION_EXPIRED") return "Bridge session expired. Pair again.";
    if (code === "PAYLOAD_REJECTED") return "Character payload was rejected by Character Archive.";
    return "Character Archive bridge failed. Return to the receiver for details.";
  }
  return {
    isRawPageContext,
    selectedCharacterId,
    matchesCharacterResponse,
    containsForbiddenTransportKey,
    createChannelNonce,
    createReceiverUrl,
    isStoredChannelState,
    validateArchiveReceiverMessage,
    bridgeErrorMessage,
  };
});
