(function installCompanionPopup(root) {
  "use strict";

  const form = root.document.getElementById("pair-form");
  const code = root.document.getElementById("pairing-code");
  const pairButton = root.document.getElementById("pair-button");
  const pairedActions = root.document.getElementById("paired-actions");
  const sendButton = root.document.getElementById("send-button");
  const disconnectButton = root.document.getElementById("disconnect-button");
  const status = root.document.getElementById("status");
  const diagnostics = root.document.getElementById("readiness-diagnostics");
  const diagnosticVersion = root.document.getElementById("diagnostic-version");
  const diagnosticTarget = root.document.getElementById("diagnostic-target");
  const diagnosticContent = root.document.getElementById("diagnostic-content");
  const diagnosticPing = root.document.getElementById("diagnostic-ping");
  const diagnosticMain = root.document.getElementById("diagnostic-main");
  const diagnosticDocument = root.document.getElementById("diagnostic-document");
  const diagnosticState = root.document.getElementById("diagnostic-state");
  const diagnosticError = root.document.getElementById("diagnostic-error");
  const developmentMode = !root.chrome?.runtime?.getManifest?.().update_url;
  let busy = false;
  let poll = null;
  let renderedState = null;

  async function request(type, extra = {}) {
    return chrome.runtime.sendMessage({ contractVersion: 1, type, ...extra });
  }

  function render(state) {
    renderedState = state;
    status.textContent = typeof state?.message === "string" ? state.message : "Companion unavailable.";
    const paired = state?.paired === true;
    form.hidden = paired || state?.phase === "SENT";
    pairedActions.hidden = !paired;
    pairButton.disabled = busy;
    pairButton.textContent = state?.selectedTargetKind === "PROFILE"
      ? "Pair Profile"
      : state?.selectedTargetKind === "CHARACTER"
        ? "Pair Character"
        : "Pair";
    const actionTargetKind = paired ? state?.pairedTargetKind : state?.selectedTargetKind;
    const actionTargetKnown = actionTargetKind === "CHARACTER" || actionTargetKind === "PROFILE";
    const profileActionEnabled = state?.profileDiscoverEnabled === true || state?.profileRetrieveEnabled === true || state?.profileCancelEnabled === true;
    sendButton.disabled = busy || !actionTargetKnown || (state?.sendEnabled !== true && state?.retryEnabled !== true && !profileActionEnabled);
    sendButton.title = !busy && typeof state?.disabledReason === "string"
      ? `Unavailable: ${state.disabledReason}`
      : "";
    disconnectButton.disabled = busy;
    sendButton.textContent = primaryActionLabel(state, actionTargetKind);
    renderDiagnostics(state?.readinessDiagnostics);
    if (["RETRIEVING", "SENDING", "PROFILE_DISCOVERING", "PROFILE_RETRIEVING"].includes(state?.phase)) startPolling();
    else stopPolling();
  }

  function renderDiagnostics(value) {
    diagnostics.hidden = !developmentMode || !value;
    if (diagnostics.hidden) return;
    const ping = safeEnum(value.lastPingResult, "NOT_ATTEMPTED");
    const main = safeEnum(value.mainProbeResult, "NOT_ATTEMPTED");
    const content = ping === "PING_OK" && value.contentReadyReceived !== true
      ? "READY · BOOT_SIGNAL_MISSING"
      : ping === "PING_OK" || (value.contentReadyReceived === true && !["RECEIVER_MISSING", "TAB_MISSING", "CONTEXT_INVALIDATED"].includes(ping))
        ? "READY"
        : ping === "NOT_ATTEMPTED" || ping === "PING_STARTED" ? "UNKNOWN" : "MISSING";
    diagnosticVersion.textContent = typeof value.extensionVersion === "string" ? `v${value.extensionVersion}` : "";
    diagnosticTarget.textContent = value.pairedTargetKind === "PROFILE" || value.pairedTargetKind === "CHARACTER"
      ? `${value.pairedTargetKind}${typeof value.targetId === "string" ? ` · ${value.targetId}` : ""}`
      : "NONE";
    diagnosticContent.textContent = content;
    diagnosticPing.textContent = ping;
    diagnosticMain.textContent = main;
    diagnosticDocument.textContent = `${safeEnum(value.documentStatus, "NOT_SEEN")}${Number.isSafeInteger(value.documentGeneration) && value.documentGeneration > 0 ? ` · generation ${value.documentGeneration}` : ""}${typeof value.documentFingerprint === "string" ? ` · ${value.documentFingerprint}` : ""}`;
    diagnosticState.textContent = safeEnum(value.currentReadinessState, "UNKNOWN") === "PAIRED_PAGE_RELOAD_REQUIRED" ? "RELOAD_REQUIRED" : safeEnum(value.currentReadinessState, "UNKNOWN");
    diagnosticError.textContent = typeof value.safeError === "string" ? value.safeError : "NONE";
  }

  function safeEnum(value, fallback) { return typeof value === "string" && /^[A-Z0-9_]{2,64}$/u.test(value) ? value : fallback; }

  function primaryActionLabel(state, actionTargetKind) {
    if (actionTargetKind === "PROFILE") {
      if (state?.phase === "PROFILE_DISCOVERING") return "Discovering…";
      if (state?.profileCancelEnabled === true) return "Cancel retrieval";
      if (state?.profileRetrieveEnabled === true) return "Retrieve selected";
      if (state?.phase === "PROFILE_REVIEW" || state?.phase === "PROFILE_CANCELLED") return "Review in Character Archive";
      if (state?.retryEnabled === true) return "Retry";
      return "Discover profile characters";
    }
    if (actionTargetKind === "CHARACTER") {
      if (state?.phase === "RETRIEVING") return "Retrieving…";
      if (state?.phase === "SENDING") return "Creating preview…";
      if (state?.retryEnabled === true && state?.retrieveEnabled !== true) return "Retry";
      return "Retrieve this Character";
    }
    return "Unavailable";
  }

  async function refresh() {
    try {
      render(await request("POPUP_GET_STATE"));
    } catch {
      render({ message: "The companion background worker is unavailable." });
    }
  }

  function startPolling() {
    if (poll !== null) return;
    poll = root.setInterval(() => void refresh(), 500);
  }

  function stopPolling() {
    if (poll === null) return;
    root.clearInterval(poll);
    poll = null;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    render({ paired: false, phase: "PAIRING", message: "Pairing with Character Archive…" });
    let result;
    try {
      result = await request("POPUP_PAIR", { pairingCode: code.value });
      code.value = "";
    } catch {
      result = {
        paired: false,
        phase: "ERROR",
        message: "Pairing could not reach Character Archive.",
        sendEnabled: false,
        disabledReason: "PAIRING_FAILED",
      };
    } finally {
      busy = false;
      render(result);
    }
  });

  sendButton.addEventListener("click", async () => {
    if (busy) return;
    const actionTargetKind = renderedState?.paired === true ? renderedState?.pairedTargetKind : renderedState?.selectedTargetKind;
    if (actionTargetKind !== "CHARACTER" && actionTargetKind !== "PROFILE") {
      render({
        paired: renderedState?.paired === true,
        phase: "ERROR",
        code: "INVALID_PAIRING_TARGET",
        message: "The pairing target is invalid or incompatible. Create a fresh pairing.",
        sendEnabled: false,
        disabledReason: "INVALID_PAIRING_TARGET",
      });
      return;
    }
    busy = true;
    let result;
    try {
      let action;
      if (actionTargetKind === "PROFILE") {
        if (renderedState?.retryEnabled === true) action = "POPUP_RETRY_READY";
        else if (renderedState?.profileCancelEnabled === true) action = "POPUP_CANCEL_PROFILE";
        else if (renderedState?.profileRetrieveEnabled === true) action = "POPUP_RETRIEVE_PROFILE_SELECTED";
        else if (renderedState?.profileDiscoverEnabled === true) action = "POPUP_DISCOVER_PROFILE";
      } else if (renderedState?.retryEnabled === true && renderedState?.retrieveEnabled !== true) action = "POPUP_RETRY_READY";
      else if (renderedState?.retrieveEnabled === true) action = "POPUP_RETRIEVE_SELECTED";
      if (!action) throw new Error("No action is available for the paired target.");
      result = await request(action);
    } catch {
      result = {
        paired: true,
        phase: "ERROR",
        message: "The selected character could not be retrieved.",
        sendEnabled: false,
        disabledReason: "COMPANION_FAILED",
      };
    } finally {
      busy = false;
      render(result);
    }
  });

  disconnectButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    let result;
    try {
      result = await request("POPUP_DISCONNECT");
    } finally {
      busy = false;
      render(result);
    }
  });

  root.addEventListener("unload", stopPolling);
  void refresh();
})(globalThis);
