(function installCharacterArchiveBackgroundController(root) {
  "use strict";

  const STATE_KEY = "characterArchiveCompanionStateV1";
  const EXPIRY_ALARM = "character-archive-companion-expiry";
  const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
  const PAIRING_CODE = /^[0-9A-F]{16}$/u;

  function createBackgroundController({
    config,
    contract,
    runtimeId,
    extensionVersion = "0.1.5",
    storage,
    fetchImpl,
    getActiveTab,
    getBoundTab = async () => null,
    sendTabMessage,
    hasSiteAccess = async () => true,
    scheduleExpiry,
    clearExpiry,
    now = Date.now,
    readinessAttempts = 3,
    readinessDelayMs = 125,
    wait = (milliseconds) => new Promise((resolve) => root.setTimeout(resolve, milliseconds)),
  }) {
    const PING_RESULTS = new Set(["NOT_ATTEMPTED", "PING_STARTED", "PING_OK", "RECEIVER_MISSING", "TAB_MISSING", "TARGET_MISMATCH", "CONTRACT_MISMATCH", "INVALID_RESPONSE", "CONTEXT_INVALIDATED", "OTHER_SAFE_FAILURE"]);
    const MAIN_RESULTS = new Set(["NOT_ATTEMPTED", "NOT_APPLICABLE", "MAIN_READY", "MAIN_MISSING", "MAIN_TARGET_MISMATCH", "MAIN_CONTRACT_MISMATCH", "MAIN_TIMEOUT"]);
    const DOCUMENT_RESULTS = new Set(["NOT_SEEN", "CURRENT", "STALE"]);
    let queue = Promise.resolve();
    function serialized(work) {
      const result = queue.then(work, work);
      queue = result.then(() => undefined, () => undefined);
      return result;
    }
    async function readState() {
      const stored = await storage.get(STATE_KEY);
      const rawState = isRecord(stored?.[STATE_KEY]) ? stored[STATE_KEY] : initialState();
      const state = { ...rawState, diagnostics: diagnosticState(rawState) };
      if (state.session && !isCompatibleSession(state.session)) {
        const incompatible = { ...initialState(), status: { phase: "ERROR", code: "INVALID_PAIRING_TARGET", message: "Stored pairing target is incompatible. Create a fresh pairing." } };
        await storage.set({ [STATE_KEY]: incompatible });
        await clearExpiry(EXPIRY_ALARM);
        return incompatible;
      }
      if (state.session && new Date(state.session.expiresAt).getTime() <= now()) {
        const expired = { ...initialState(), status: { phase: "EXPIRED", message: "Capability expired. Create a new one-time pairing." } };
        await storage.set({ [STATE_KEY]: expired });
        await clearExpiry(EXPIRY_ALARM);
        return expired;
      }
      return state;
    }
    function isCompatibleSession(session) {
      return isRecord(session)
        && typeof session.bridgeToken === "string" && TOKEN.test(session.bridgeToken)
        && typeof session.jobId === "string" && Boolean(session.jobId)
        && typeof session.expiresAt === "string" && Number.isFinite(new Date(session.expiresAt).getTime())
        && Number.isSafeInteger(session.tabId)
        && Boolean(contract.validateTarget(session.target));
    }
    async function writeState(state) {
      const normalized = { ...state, diagnostics: diagnosticState(state, { currentReadinessState: safeReadinessState(state.status?.phase) }) };
      await storage.set({ [STATE_KEY]: normalized });
      return normalized;
    }
    async function clearState(status = initialState().status) {
      await clearExpiry(EXPIRY_ALARM);
      return writeState({ ...initialState(), status });
    }

    async function handleMessage(message, sender) {
      return serialized(async () => {
        if (!isRecord(message) || message.contractVersion !== 1 || typeof message.type !== "string") return failure("INVALID_EXTENSION_MESSAGE", "The companion message was rejected.");
        if (message.type.startsWith("POPUP_")) {
          if (!isPopupSender(sender, runtimeId)) return failure("UNTRUSTED_EXTENSION_SENDER", "The companion sender was rejected.");
          if (message.type === "POPUP_GET_STATE" && exactKeys(message, ["contractVersion", "type"])) return popupState();
          if (message.type === "POPUP_PAIR" && exactKeys(message, ["contractVersion", "type", "pairingCode"])) return pair(message.pairingCode);
          if (message.type === "POPUP_RETRY_READY" && exactKeys(message, ["contractVersion", "type"])) return retryReadiness();
          if (message.type === "POPUP_RETRIEVE_SELECTED" && exactKeys(message, ["contractVersion", "type"])) return retrieveSelectedTarget();
          if (message.type === "POPUP_DISCOVER_PROFILE" && exactKeys(message, ["contractVersion", "type"])) return discoverProfile();
          if (message.type === "POPUP_RETRIEVE_PROFILE_SELECTED" && exactKeys(message, ["contractVersion", "type"])) return retrieveProfileSelected();
          if (message.type === "POPUP_CANCEL_PROFILE" && exactKeys(message, ["contractVersion", "type"])) return cancelProfile();
          if (message.type === "POPUP_SEND_SELECTED" && exactKeys(message, ["contractVersion", "type"])) return armSelectedTarget();
          if (message.type === "POPUP_DISCONNECT" && exactKeys(message, ["contractVersion", "type"])) return safeState(await clearState());
          return failure("INVALID_EXTENSION_MESSAGE", "The companion message was rejected.");
        }
        if (message.type === "PROFILE_CONTENT_READY" && exactKeys(message, ["contractVersion", "type", "targetKind", "platform", "documentNonce"])) return profileContentReady(message, sender);
        if (message.type === "CONTENT_READY" && exactKeys(message, ["contractVersion", "type", "target"])) return contentReady(message, sender);
        if (message.type === "CONTENT_ARMED" && exactKeys(message, ["contractVersion", "type", "target"])) return contentArmed(message, sender);
        if (message.type === "CONTENT_RETRIEVAL_FAILED" && exactKeys(message, ["contractVersion", "type", "target", "code"])) return contentRetrievalFailed(message, sender);
        if (message.type === "CONTENT_PROFILE_DISCOVERY" && exactKeys(message, ["contractVersion", "type", "target", "result"])) return contentProfileDiscovery(message, sender);
        if (message.type === "CONTENT_PROFILE_DETAIL" && exactKeys(message, ["contractVersion", "type", "target", "externalId", "result"])) return contentProfileDetail(message, sender);
        if (message.type === "CONTENT_PROFILE_COMPLETE" && exactKeys(message, ["contractVersion", "type", "target", "result"])) return contentProfileComplete(message, sender);
        if (message.type === "CONTENT_CAPTURE" && exactKeys(message, ["contractVersion", "type", "capture"])) return receiveCapture(message.capture, sender);
        return failure("INVALID_EXTENSION_MESSAGE", "The companion message was rejected.");
      });
    }

    async function profileContentReady(message, sender) {
      const trusted = contentSender(sender, runtimeId, contract);
      if (!trusted || trusted.selected?.targetKind !== "PROFILE" || message.targetKind !== "PROFILE" || message.platform !== "JANITOR_AI" || typeof message.documentNonce !== "string" || !/^[0-9a-f]{32}$/u.test(message.documentNonce)) {
        return failure("UNTRUSTED_CONTENT_SENDER", "The profile content boundary was rejected.");
      }
      const state = await readState();
      const sessionMatches = Boolean(state.session && state.session.tabId === trusted.tabId && contract.sameTarget(state.session.target, trusted.selected));
      if (sessionMatches) {
        const fingerprint = fingerprintNonce(message.documentNonce);
        const previous = diagnosticState(state);
        await writeState({ ...state, diagnostics: diagnosticState(state, {
          contentReadyReceived: true,
          contentReadyContractVersion: message.contractVersion,
          documentFingerprint: fingerprint,
          documentGeneration: previous.documentFingerprint === fingerprint ? previous.documentGeneration : previous.documentGeneration + 1,
          documentStatus: "CURRENT",
          safeError: null,
        }) });
      }
      return { ok: true, contractVersion: 1, targetKind: "PROFILE", platform: "JANITOR_AI" };
    }

    async function pair(pairingCodeValue) {
      const active = await inspectActiveTab();
      if (!active.selected) return failure("WRONG_PAGE", "Open a supported Janitor character or exact profile page before pairing.", active);
      if (active.tabIdPresent !== true) return failure("TAB_ID_UNAVAILABLE", "The selected Janitor target tab could not be bound.", active);
      if (typeof pairingCodeValue !== "string") return failure("INVALID_PAIRING", "Enter a valid one-time pairing code.");
      const pairingCode = pairingCodeValue.toUpperCase().replace(/[\s-]/gu, "");
      if (!PAIRING_CODE.test(pairingCode)) return failure("INVALID_PAIRING", "Enter a valid one-time pairing code.");
      await writeState({ ...initialState(), status: { phase: "PAIRING", message: "Pairing with Character Archive…" } });
      try {
        const response = await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/pair/exchange`, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pairingCode, bridgeVersion: config.bridgeVersion, operation: config.operation, target: active.selected }),
        });
        const body = await readResponseObject(response);
        const target = contract.validateTarget(body.target);
        if (!response.ok || typeof body.bridgeToken !== "string" || !TOKEN.test(body.bridgeToken) || typeof body.jobId !== "string" || !body.jobId || typeof body.expiresAt !== "string" || !Number.isFinite(new Date(body.expiresAt).getTime()) || !target || !contract.sameTarget(target, active.selected)) {
          const code = safeErrorCode(body) ?? "PAIRING_FAILED";
          await clearState({ phase: "ERROR", code, message: pairingErrorMessage(code) });
          return failure(code, pairingErrorMessage(code));
        }
        const state = {
          session: { bridgeToken: body.bridgeToken, jobId: body.jobId, expiresAt: body.expiresAt, target, tabId: active.tab.id },
          armed: null,
          operation: null,
          profile: null,
          status: { phase: "PAIRED", message: `Paired. Checking ${target.externalId ?? target.profileId}…` },
        };
        await writeState(state);
        await scheduleExpiry(EXPIRY_ALARM, new Date(body.expiresAt).getTime());
        const probed = await probeWithRecordedDiagnostics(state, await inspectBoundTab(state.session), state.session.target);
        const readiness = probed.readiness;
        const readyState = await writeState(stateForReadiness(probed.state, readiness));
        return safeState(readyState, readiness);
      } catch {
        await clearState({ phase: "ERROR", code: "PAIRING_FAILED", message: "Pairing could not reach Character Archive." });
        return failure("PAIRING_FAILED", "Pairing could not reach Character Archive.");
      }
    }

    async function armSelectedTarget() {
      const state = await readState();
      if (!state.session) return failure("CAPABILITY_EXPIRED", "Create a new pairing before sending a character.");
      const active = await inspectBoundTab(state.session);
      if (!active.selected || active.tabIdPresent !== true || active.boundTabStale === true || !contract.sameTarget(active.selected, state.session.target)) return safeState(state, active);
      const next = {
        ...state,
        armed: { tabId: active.tab.id, target: state.session.target },
        status: { phase: "ARMED_PENDING_PAGE", message: "Observer armed. Reload the selected character page to capture its normal response." },
      };
      const boundActive = { ...active, boundTabId: active.tab.id, boundTarget: state.session.target, boundTabStale: false };
      await writeState(next);
      try {
        const acknowledgement = await sendTabMessage(active.tab.id, { contractVersion: 1, type: "ARM_SELECTED_TARGET", target: state.session.target });
        if (!isRecord(acknowledgement) || acknowledgement.ok !== true || acknowledgement.version !== 1 || acknowledgement.armed !== true || !contract.sameTarget(acknowledgement.target, state.session.target) || acknowledgement.observerReachable !== true) {
          const observerUnavailable = isRecord(acknowledgement) && acknowledgement.code === "UNSUPPORTED_CAPTURE_METHOD";
          const unavailable = observerUnavailable ? observerUnavailableState(next) : contentUnavailableState(next, safeRuntimeError(null, acknowledgement));
          await writeState(unavailable);
          return safeState(unavailable, { ...boundActive, contentScriptReachable: !observerUnavailable, observerReachable: false });
        }
      } catch (error) {
        const unavailable = contentUnavailableState(next, safeRuntimeError(error));
        await writeState(unavailable);
        return safeState(unavailable, { ...boundActive, contentScriptReachable: false, observerReachable: null, runtimeError: unavailable.status.runtimeError });
      }
      const armedState = { ...next, status: { phase: "OBSERVER_ARMED", message: "Observer armed. Reload the selected character page to capture its normal response." } };
      await writeState(armedState);
      return safeState(armedState, { ...boundActive, contentScriptReachable: true, observerReachable: true, observerArmed: true });
    }

    async function retrieveSelectedTarget() {
      const state = await readState();
      if (!state.session) return failure("CAPABILITY_EXPIRED", "Create a new pairing before retrieving a character.");
      if (state.operation || ["RETRIEVING", "SENDING", "SENT"].includes(state.status.phase)) return safeState(state, await inspectBoundTab(state.session));
      const bound = await inspectBoundTab(state.session);
      if (!bound.activeTabPresent || !bound.selected || bound.boundTabStale === true || !contract.sameTarget(bound.selected, state.session.target)) return safeState(state, bound);
      const readiness = await probeActiveTab(bound, state.session.target);
      if (readiness.contentScriptReachable !== true || readiness.activeRetrievalReachable !== true || readiness.wrongCharacterPage === true) {
        const unavailable = await writeState(stateForReadiness(state, readiness));
        return safeState(unavailable, readiness);
      }
      const next = {
        ...state,
        armed: null,
        operation: { type: "ACTIVE_RETRIEVAL", tabId: bound.tab.id, target: state.session.target },
        status: { phase: "RETRIEVING", message: "Retrieving the selected character in this Janitor tab…" },
      };
      await writeState(next);
      try {
        const acknowledgement = await sendTabMessage(bound.tab.id, { contractVersion: 1, type: "RETRIEVE_SELECTED_CHARACTER", target: state.session.target });
        if (!isRecord(acknowledgement) || acknowledgement.ok !== true || acknowledgement.version !== 1 || acknowledgement.accepted !== true || !contract.sameTarget(acknowledgement.target, state.session.target)) {
          const code = isRecord(acknowledgement) && contract.isRetrievalErrorCode(acknowledgement.code) ? acknowledgement.code : "SOURCE_CONTRACT_CHANGED";
          const failedState = { ...next, operation: null, status: { phase: "READY", code, message: retrievalErrorMessage(code) } };
          await writeState(failedState);
          return { ...safeState(failedState, readiness), ok: false };
        }
        return safeState(next, readiness);
      } catch (error) {
        const unavailable = contentUnavailableState({ ...next, operation: null }, safeRuntimeError(error));
        await writeState(unavailable);
        return { ...safeState(unavailable, { ...readiness, contentScriptReachable: false }), ok: false };
      }
    }

    async function discoverProfile() {
      const state = await readState(); if (!state.session || typeof state.session.target?.profileId !== "string") return failure("WRONG_PROFILE", "Pair an exact Janitor profile first.");
      if (state.operation) return safeState(state, await inspectBoundTab(state.session));
      const bound = await inspectBoundTab(state.session); const readiness = await probeActiveTab(bound, state.session.target);
      if (readiness.profileRetrievalReachable !== true || readiness.boundTabStale) return safeState(await writeState(stateForReadiness(state, readiness)), readiness);
      const next = { ...state, operation: { type: "PROFILE_DISCOVERY", tabId: bound.tab.id, target: state.session.target }, status: { phase: "PROFILE_DISCOVERING", message: "Discovering profile characters…" } };
      await writeState(next);
      try { const ack = await sendTabMessage(bound.tab.id, { contractVersion: 1, type: "DISCOVER_PROFILE_CHARACTERS", target: state.session.target }); if (ack?.accepted !== true) throw new Error("Discovery was not accepted."); return safeState(next, readiness); }
      catch { const failedState = { ...next, operation: null, status: { phase: "READY", code: "SOURCE_UNAVAILABLE", message: "Profile discovery could not start." } }; await writeState(failedState); return { ...safeState(failedState, readiness), ok: false }; }
    }

    async function contentProfileDiscovery(message, sender) {
      const page = contentSender(sender, runtimeId, contract); const state = await readState();
      if (!page || !state.session || state.operation?.type !== "PROFILE_DISCOVERY" || state.operation.tabId !== page.tabId || !contract.sameTarget(message.target, state.session.target)) return failure("WRONG_PROFILE", "The profile discovery result was rejected.");
      const result = message.result;
      if (!isRecord(result) || result.status !== "DISCOVERED" || !Array.isArray(result.items) || result.items.length > 100) { const code = result?.code ?? "INVALID_SOURCE_PAYLOAD"; const failedState = { ...state, operation: null, status: { phase: "READY", code, message: retrievalErrorMessage(code) } }; await writeState(failedState); return { ...safeState(failedState), ok: false }; }
      const body = { profileId: state.session.target.profileId, items: result.items, reportedTotal: result.reportedTotal ?? null, truncated: result.truncated === true };
      const response = await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/profile/discovery`, { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", "X-Archive-Bridge-Token": state.session.bridgeToken }, body: JSON.stringify(body) });
      if (!response.ok) { const failedState = { ...state, operation: null, status: { phase: "READY", code: "INVALID_PROFILE_DISCOVERY", message: "Character Archive rejected the profile discovery result." } }; await writeState(failedState); return { ...safeState(failedState), ok: false }; }
      const profile = { discoveredIds: result.items.map((item) => item.externalId), discovered: result.items.length, truncated: result.truncated === true, selected: 0, ready: 0, failed: 0 };
      const discoveredState = { ...state, operation: null, profile, status: { phase: "PROFILE_DISCOVERED", message: `${profile.discovered} characters discovered. Select characters in Character Archive.` } };
      await writeState(discoveredState); return safeState(discoveredState);
    }

    async function retrieveProfileSelected() {
      const state = await readState(); if (!state.session || !state.profile || typeof state.session.target?.profileId !== "string") return failure("PROFILE_DISCOVERY_REQUIRED", "Discover this profile first.");
      const selectionResponse = await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/profile/selection`, { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { "X-Archive-Bridge-Token": state.session.bridgeToken } });
      const selection = await readResponseObject(selectionResponse); const allowed = new Set(state.profile.discoveredIds);
      if (!selectionResponse.ok || !Array.isArray(selection.selectedIds) || selection.selectedIds.length === 0 || selection.selectedIds.some((id) => typeof id !== "string" || !allowed.has(id))) return failure("INVALID_PROFILE_SELECTION", "Select discovered characters in Character Archive first.");
      const bound = await inspectBoundTab(state.session); const next = { ...state, operation: { type: "PROFILE_RETRIEVAL", tabId: bound.tab.id, target: state.session.target }, profile: { ...state.profile, selected: selection.selectedIds.length, ready: 0, failed: 0 }, status: { phase: "PROFILE_RETRIEVING", message: `Retrieving 0/${selection.selectedIds.length}…` } };
      await writeState(next); const ack = await sendTabMessage(bound.tab.id, { contractVersion: 1, type: "RETRIEVE_PROFILE_SELECTED", target: state.session.target, selectedIds: selection.selectedIds });
      if (ack?.accepted !== true) { const failedState = { ...next, operation: null, status: { phase: "PROFILE_DISCOVERED", code: "SOURCE_UNAVAILABLE", message: "Selected retrieval could not start." } }; await writeState(failedState); return { ...safeState(failedState), ok: false }; }
      return safeState(next);
    }

    async function contentProfileDetail(message, sender) {
      const page = contentSender(sender, runtimeId, contract); const state = await readState(); if (!page || state.operation?.type !== "PROFILE_RETRIEVAL" || !state.session || !contract.sameTarget(message.target, state.session.target)) return failure("WRONG_PROFILE", "The profile detail result was rejected.");
      const allowed = new Set(state.profile?.discoveredIds ?? []); if (!allowed.has(message.externalId)) return failure("UNDISCOVERED_CHARACTER", "The character was not discovered under this profile.");
      let ready = state.profile.ready; let failedCount = state.profile.failed;
      if (message.result?.status === "RETRIEVED") {
        const characterTarget = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId: message.externalId, canonicalSourceUrl: `https://janitorai.com/characters/${message.externalId}`, pageOrigin: state.session.target.pageOrigin };
        const capture = { messageId: root.crypto.randomUUID(), capturedAt: new Date().toISOString(), target: characterTarget, observerContractVersion: 1, payload: message.result.payload };
        if (!contract.validateForwardedCapture(capture, characterTarget)) return failure("INVALID_SOURCE_PAYLOAD", "The profile character payload was rejected.");
        const response = await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/profile/batch`, { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", "X-Archive-Bridge-Token": state.session.bridgeToken }, body: JSON.stringify({ envelopes: [contract.createBridgeEnvelope(capture)] }) });
        const body = await readResponseObject(response); const accepted = response.ok && body.results?.[0]?.status === "PREVIEW_READY";
        ready += accepted ? 1 : 0; failedCount += accepted ? 0 : 1;
      } else {
        failedCount += 1;
        await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/profile/status`, { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", "X-Archive-Bridge-Token": state.session.bridgeToken }, body: JSON.stringify({ externalId: message.externalId, status: profileFailureStatus(message.result?.code), errorCode: message.result?.code ?? "RETRIEVAL_FAILED" }) });
      }
      const progress = { ...state, profile: { ...state.profile, ready, failed: failedCount }, status: { phase: "PROFILE_RETRIEVING", message: `Retrieving ${ready + failedCount}/${state.profile.selected} — ${ready} ready, ${failedCount} failed` } };
      await writeState(progress); return safeState(progress);
    }

    async function contentProfileComplete(message, sender) {
      const page = contentSender(sender, runtimeId, contract); const state = await readState(); if (!page || state.operation?.type !== "PROFILE_RETRIEVAL" || !state.session || !contract.sameTarget(message.target, state.session.target)) return failure("WRONG_PROFILE", "The profile completion was rejected.");
      const completionStatus = message.result?.status === "CANCELLED" ? "CANCELLED" : "COMPLETE";
      const response = await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/profile/complete`, { method: "POST", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", "X-Archive-Bridge-Token": state.session.bridgeToken }, body: JSON.stringify({ status: completionStatus }) });
      if (!response.ok) return failure("BRIDGE_TRANSPORT_FAILED", "Character Archive could not finalize the profile operation.");
      const complete = { ...state, operation: null, status: { phase: message.result?.status === "CANCELLED" ? "PROFILE_CANCELLED" : "PROFILE_REVIEW", message: `${state.profile.ready} previews ready. Review and Save Selected in Character Archive.` } };
      await writeState(complete); return safeState(complete);
    }

    async function cancelProfile() { const state = await readState(); if (!state.session || state.operation?.type !== "PROFILE_RETRIEVAL") return safeState(state); try { await sendTabMessage(state.operation.tabId, { contractVersion: 1, type: "CANCEL_PROFILE_RETRIEVAL", target: state.session.target }); } catch { /* Best effort. */ } const cancelling = { ...state, status: { phase: "PROFILE_RETRIEVING", message: "Cancelling profile retrieval…" } }; await writeState(cancelling); return safeState(cancelling); }

    async function retryReadiness() {
      const state = await readState();
      if (!state.session) return failure("CAPABILITY_EXPIRED", "Create a new pairing before checking readiness.");
      const bound = await inspectBoundTab(state.session);
      if (!bound.activeTabPresent) {
        const unavailable = await writeState({ ...state, armed: null, diagnostics: immediateDiagnostic(state, "TAB_MISSING"), status: { phase: "PAIRED_PAGE_RELOAD_REQUIRED", code: "BOUND_TAB_UNAVAILABLE", message: "Paired, but the bound Janitor tab is unavailable." } });
        return safeState(unavailable, bound);
      }
      if (bound.boundTabStale === true || !bound.selected || !contract.sameTarget(bound.selected, state.session.target)) {
        const mismatch = targetMismatch(state.session.target, bound.isSupportedCharacterPage);
        const wrongPage = await writeState({ ...state, armed: null, diagnostics: immediateDiagnostic(state, "TARGET_MISMATCH"), status: { phase: "PAIRED_PAGE_RELOAD_REQUIRED", ...mismatch } });
        return safeState(wrongPage, bound);
      }
      const probed = await probeWithRecordedDiagnostics({ ...state, armed: null }, bound, state.session.target);
      const readiness = probed.readiness;
      const readyState = await writeState(stateForReadiness(probed.state, readiness));
      return safeState(readyState, readiness);
    }

    async function contentReady(message, sender) {
      const page = contentSender(sender, runtimeId, contract);
      if (!page || !contract.sameTarget(message.target, page.selected)) return { arm: false };
      const state = await readState();
      const bindingMatches = Boolean(state.session && state.armed && state.armed.tabId === page.tabId && contract.sameTarget(state.armed.target, page.selected) && contract.sameTarget(state.session.target, page.selected));
      const arm = bindingMatches && !["SENDING", "SENT"].includes(state.status.phase);
      if (arm) await writeState({ ...state, status: { phase: "ARMED_PENDING_PAGE", message: "New document detected. Re-arming the selected character observer…" } });
      return arm ? { arm: true, target: page.selected } : { arm: false };
    }

    async function contentArmed(message, sender) {
      const page = contentSender(sender, runtimeId, contract);
      if (!page || !contract.sameTarget(message.target, page.selected)) return failure("WRONG_CHARACTER", "The observer acknowledgment came from the wrong character page.");
      const state = await readState();
      if (!state.session || !state.armed || ["SENDING", "SENT"].includes(state.status.phase) || state.armed.tabId !== page.tabId || !contract.sameTarget(state.armed.target, page.selected) || !contract.sameTarget(state.session.target, page.selected)) return failure("CAPTURE_NOT_OBSERVED", "This character is not bound for capture.");
      const armedState = { ...state, status: { phase: "OBSERVER_ARMED", message: "Observer armed. Waiting for the selected character response…" } };
      await writeState(armedState);
      return { ok: true, phase: "OBSERVER_ARMED", target: page.selected };
    }

    async function contentRetrievalFailed(message, sender) {
      const page = contentSender(sender, runtimeId, contract);
      if (!page || !contract.sameTarget(message.target, page.selected) || !contract.isRetrievalErrorCode(message.code)) return failure("INVALID_SOURCE_PAYLOAD", "The browser-local retrieval result was rejected.");
      const state = await readState();
      if (!state.session || !state.operation || state.operation.type !== "ACTIVE_RETRIEVAL" || state.operation.tabId !== page.tabId || !contract.sameTarget(state.operation.target, page.selected) || !contract.sameTarget(state.session.target, page.selected)) return failure("CAPTURE_NOT_OBSERVED", "No matching browser-local retrieval is active.");
      const failedState = { ...state, operation: null, status: { phase: "READY", code: message.code, message: retrievalErrorMessage(message.code) } };
      await writeState(failedState);
      return { ...safeState(failedState), ok: false };
    }

    async function receiveCapture(captureValue, sender) {
      const page = contentSender(sender, runtimeId, contract);
      if (!page) return failure("UNTRUSTED_EXTENSION_SENDER", "The companion sender was rejected.");
      const state = await readState();
      const passiveMatches = Boolean(state.armed && state.armed.tabId === page.tabId && contract.sameTarget(state.armed.target, page.selected));
      const activeMatches = Boolean(state.operation && state.operation.type === "ACTIVE_RETRIEVAL" && state.operation.tabId === page.tabId && contract.sameTarget(state.operation.target, page.selected));
      if (!state.session || state.status.phase === "SENDING" || (!passiveMatches && !activeMatches) || !contract.sameTarget(state.session.target, page.selected)) return failure("CAPTURE_NOT_OBSERVED", "This character was not selected for transfer.");
      const capture = contract.validateForwardedCapture(captureValue, state.session.target);
      if (!capture) return failure("INVALID_SOURCE_PAYLOAD", "The selected character capture was rejected.");
      await writeState({ ...state, status: { phase: "SENDING", message: `Sending ${capture.payload.name.trim().slice(0, 80)}…` } });
      try {
        const response = await fetchImpl(`${config.archiveOrigin}/api/bridge/extension/import`, {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json", "X-Archive-Bridge-Token": state.session.bridgeToken },
          body: JSON.stringify(contract.createBridgeEnvelope(capture)),
        });
        const body = await readResponseObject(response);
        if (!response.ok) {
          const code = safeErrorCode(body) ?? "INVALID_SOURCE_PAYLOAD";
          const capabilityInvalid = ["CAPABILITY_EXPIRED", "WRONG_CHARACTER"].includes(code);
        const failedState = capabilityInvalid ? { ...initialState(), status: { phase: "ERROR", code, message: importErrorMessage(code) } } : { ...state, armed: null, operation: null, status: { phase: "READY", code, message: importErrorMessage(code) } };
          await writeState(failedState);
          if (capabilityInvalid) await clearExpiry(EXPIRY_ALARM);
          return failure(code, importErrorMessage(code));
        }
        const characterName = capture.payload.name.trim().slice(0, 80);
        const sent = await clearState({ phase: "SENT", message: `${characterName} sent successfully. Return to Character Archive to preview.`, characterName, jobId: typeof body.jobId === "string" ? body.jobId : state.session.jobId });
        return safeState(sent);
      } catch {
        const failed = { ...state, armed: null, operation: null, status: { phase: "READY", code: "SOURCE_UNAVAILABLE", message: "The selected character could not reach Character Archive. Pairing remains available until expiry." } };
        await writeState(failed);
        return failure("BRIDGE_TRANSPORT_FAILED", failed.status.message);
      }
    }

    async function handleTabRemoved(tabId) {
      return serialized(async () => {
        const state = await readState();
        if (state.session?.tabId !== tabId && state.armed?.tabId !== tabId && state.operation?.tabId !== tabId) return;
        if (!state.session) return clearState();
        await writeState({ ...state, armed: null, operation: null, status: { phase: "PAIRED_PAGE_RELOAD_REQUIRED", code: "BOUND_TAB_UNAVAILABLE", message: "Paired, but the bound Janitor tab is unavailable." } });
      });
    }
    async function handleExpiryAlarm(name) {
      if (name !== EXPIRY_ALARM) return;
      return serialized(async () => clearState({ phase: "EXPIRED", message: "Capability expired. Create a new one-time pairing." }));
    }
    async function popupState() {
      let state = await readState();
      const target = state.session ? await inspectBoundTab(state.session) : await inspectActiveTab();
      if (state.session && (state.armed || state.operation) && target.boundTabStale === true) state = await writeState({ ...state, armed: null, operation: null, status: { phase: "PAIRED_PAGE_RELOAD_REQUIRED", ...targetMismatch(state.session.target, target.isSupportedCharacterPage) } });
      const probed = state.session && target.boundTabStale !== true ? await probeWithRecordedDiagnostics(state, target, state.session.target) : { state, readiness: target };
      state = probed.state;
      const readiness = probed.readiness;
      if (state.session && state.armed && state.status.phase === "ARMED_PENDING_PAGE" && readiness.observerArmed === true) state = await writeState({ ...state, status: { phase: "OBSERVER_ARMED", message: "Observer armed. Waiting for the selected character response…" } });
      if (state.session && !state.armed && !state.operation && readiness.boundTabStale !== true) state = await writeState(stateForReadiness(state, readiness));
      return safeState(state, readiness);
    }

    async function inspectBoundTab(bound) {
      const expected = contract.validateTarget(bound.target);
      const tab = await getBoundTab(bound.tabId);
      if (!expected || typeof bound.tabId !== "number" || !tab || typeof tab.id !== "number" || tab.id !== bound.tabId) return emptyTabState({ boundTabId: typeof bound.tabId === "number" ? bound.tabId : null, boundTarget: expected, boundTabStale: true });
      const actual = typeof tab.url === "string" ? contract.matchPage(tab.url) : null;
      return {
        tab,
        selected: actual,
        activeTabPresent: true,
        tabIdPresent: true,
        urlPresent: typeof tab.url === "string",
        isSupportedCharacterPage: Boolean(actual),
        selectedExternalIdPresent: Boolean(actual?.externalId),
        queryResultCount: null,
        windowId: typeof tab.windowId === "number" ? tab.windowId : null,
        boundTabId: bound.tabId,
        boundTarget: expected,
        boundTabStale: !contract.sameTarget(actual, expected),
        contentScriptReachable: null,
        observerReachable: null,
        observerArmed: false,
        activeRetrievalReachable: null,
        siteAccessGranted: null,
        runtimeError: null,
        readinessFailure: null,
      };
    }

    async function probeWithRetry(active, expectedTarget) {
      const attempts = Number.isInteger(readinessAttempts) ? Math.min(Math.max(readinessAttempts, 1), 5) : 3;
      let readiness = active;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        readiness = await probeActiveTab(active, expectedTarget);
        if (readiness.contentScriptReachable === true || readiness.siteAccessGranted === false || readiness.wrongCharacterPage === true) return readiness;
        if (attempt + 1 < attempts) await wait(readinessDelayMs);
      }
      return readiness;
    }

    async function probeWithRecordedDiagnostics(state, active, expectedTarget) {
      const startedAt = new Date(now()).toISOString();
      let next = await writeState({ ...state, diagnostics: diagnosticState(state, {
        lastPingAttemptAt: startedAt,
        lastPingResult: "PING_STARTED",
        mainProbeResult: targetKind(expectedTarget) === "PROFILE" ? "NOT_ATTEMPTED" : "NOT_APPLICABLE",
        safeError: null,
      }) });
      const readiness = await probeWithRetry(active, expectedTarget);
      const pingResult = diagnosticPingResult(readiness);
      const mainProbeResult = targetKind(expectedTarget) === "PROFILE"
        ? pingResult !== "PING_OK" ? "NOT_ATTEMPTED" : MAIN_RESULTS.has(readiness.mainProbeResult) ? readiness.mainProbeResult : readiness.profileRetrievalReachable === true ? "MAIN_READY" : "MAIN_MISSING"
        : "NOT_APPLICABLE";
      const previous = diagnosticState(next);
      const responseFingerprint = pingResult === "PING_OK" && typeof readiness.documentNonce === "string" ? fingerprintNonce(readiness.documentNonce) : null;
      const documentChanged = Boolean(responseFingerprint && previous.documentFingerprint !== responseFingerprint);
      next = await writeState({ ...next, diagnostics: diagnosticState(next, {
        lastPingAttemptAt: startedAt,
        lastPingResult: pingResult,
        mainProbeResult,
        documentFingerprint: responseFingerprint ?? previous.documentFingerprint,
        documentGeneration: documentChanged ? previous.documentGeneration + 1 : previous.documentGeneration,
        documentStatus: responseFingerprint ? "CURRENT" : previous.documentFingerprint && pingResult !== "PING_OK" ? "STALE" : previous.documentStatus,
        safeError: pingResult !== "PING_OK" ? pingResult : mainProbeResult.startsWith("MAIN_") && mainProbeResult !== "MAIN_READY" ? mainProbeResult : null,
      }) });
      return { state: next, readiness };
    }

    function stateForReadiness(state, readiness) {
      if (typeof state.session?.target?.profileId === "string" && readiness.contentScriptReachable === true && readiness.profileRetrievalReachable === true && readiness.wrongCharacterPage !== true) {
        if (state.profile || ["PROFILE_DISCOVERING", "PROFILE_DISCOVERED", "PROFILE_RETRIEVING", "PROFILE_REVIEW", "PROFILE_CANCELLED"].includes(state.status.phase)) return state;
        return { ...state, status: { phase: "READY", message: `Ready to discover profile ${state.session.target.profileId}.` } };
      }
      if (readiness.contentScriptReachable === true && readiness.activeRetrievalReachable === true && readiness.wrongCharacterPage !== true) {
        return { ...state, status: { phase: "READY", message: `Ready to retrieve ${state.session.target.externalId}.` } };
      }
      if (readiness.contentScriptReachable === true && readiness.activeRetrievalReachable === false) return activeRetrievalUnavailableState(state);
      if (readiness.contentScriptReachable === false) return contentUnavailableState(state, readiness.runtimeError);
      return state;
    }

    async function probeActiveTab(active, expectedTarget) {
      if (!active.selected || !active.tab || typeof active.tab.id !== "number") return active;
      let siteAccessGranted = null;
      try { siteAccessGranted = await hasSiteAccess(active.selected.pageOrigin); } catch { /* Diagnostic only. */ }
      if (siteAccessGranted === false) return { ...active, siteAccessGranted, contentScriptReachable: false, observerReachable: null, observerArmed: false, runtimeError: null, readinessFailure: "SITE_ACCESS_DENIED" };
      try {
        const expectedKind = targetKind(expectedTarget);
        const ping = expectedKind === "PROFILE"
          ? { type: "PROFILE_ARCHIVE_PING", version: 1, targetKind: "PROFILE" }
          : { type: "CHARACTER_ARCHIVE_PING", version: 1, targetKind: "CHARACTER" };
        const response = await sendTabMessage(active.tab.id, ping);
        if (!isRecord(response)) return { ...active, siteAccessGranted, contentScriptReachable: false, observerReachable: null, activeRetrievalReachable: null, observerArmed: false, runtimeError: safeRuntimeError(null, response), readinessFailure: "INVALID_RESPONSE" };
        const profileResponseValid = expectedKind !== "PROFILE" || (response.receiverAlive === true && MAIN_RESULTS.has(response.mainProbeResult) && typeof response.documentNonce === "string" && /^[0-9a-f]{32}$/u.test(response.documentNonce));
        if (response.ok !== true || response.version !== 1 || response.targetKind !== expectedKind || !contract.validateTarget(response.target) || !profileResponseValid) return { ...active, siteAccessGranted, contentScriptReachable: false, observerReachable: null, activeRetrievalReachable: null, observerArmed: false, runtimeError: safeRuntimeError(null, response), readinessFailure: "CONTRACT_MISMATCH" };
        if (!contract.sameTarget(response.target, active.selected) || !contract.sameTarget(active.selected, expectedTarget)) return { ...active, siteAccessGranted, contentScriptReachable: true, observerReachable: response.observerReachable === true, activeRetrievalReachable: response.activeRetrievalReachable === true, observerArmed: response.observerArmed === true, wrongCharacterPage: true, runtimeError: null, readinessFailure: "TARGET_MISMATCH" };
        return { ...active, siteAccessGranted, contentScriptReachable: true, observerReachable: response.observerReachable === true, activeRetrievalReachable: response.activeRetrievalReachable === true, profileRetrievalReachable: response.profileRetrievalReachable === true, mainProbeResult: MAIN_RESULTS.has(response.mainProbeResult) ? response.mainProbeResult : null, observerArmed: response.observerArmed === true, documentNonce: typeof response.documentNonce === "string" && /^[0-9a-f]{32}$/u.test(response.documentNonce) ? response.documentNonce : null, runtimeError: null, readinessFailure: null };
      } catch (error) {
        return { ...active, siteAccessGranted, contentScriptReachable: false, observerReachable: null, observerArmed: false, runtimeError: safeRuntimeError(error), readinessFailure: classifySendMessageFailure(error) };
      }
    }

    async function inspectActiveTab() {
      const result = await getActiveTab();
      const resolved = isRecord(result) && Object.hasOwn(result, "tab") ? result : { tab: result, queryResultCount: result ? 1 : 0, windowId: result?.windowId ?? null };
      const tab = resolved.tab;
      if (!tab) return emptyTabState({ queryResultCount: typeof resolved.queryResultCount === "number" ? resolved.queryResultCount : 0, windowId: typeof resolved.windowId === "number" ? resolved.windowId : null });
      const selected = typeof tab.url === "string" ? contract.matchPage(tab.url) : null;
      return {
        tab,
        selected,
        activeTabPresent: true,
        tabIdPresent: typeof tab.id === "number",
        urlPresent: typeof tab.url === "string",
        isSupportedCharacterPage: Boolean(selected),
        selectedExternalIdPresent: Boolean(selected?.externalId),
        queryResultCount: typeof resolved.queryResultCount === "number" ? resolved.queryResultCount : 1,
        windowId: typeof tab.windowId === "number" ? tab.windowId : typeof resolved.windowId === "number" ? resolved.windowId : null,
        boundTabId: null,
        boundTarget: null,
        boundTabStale: false,
        contentScriptReachable: null,
        observerReachable: null,
        observerArmed: false,
        activeRetrievalReachable: null,
        siteAccessGranted: null,
        runtimeError: null,
      };
    }

    function diagnosticState(state, overrides = {}) {
      const previous = isRecord(state?.diagnostics) ? state.diagnostics : {};
      const sessionTarget = state?.session?.target;
      const candidate = { ...previous, ...overrides };
      const pairedTargetKind = targetKind(sessionTarget);
      const targetId = pairedTargetKind === "PROFILE" ? sessionTarget.profileId : pairedTargetKind === "CHARACTER" ? sessionTarget.externalId : null;
      return {
        extensionVersion: typeof extensionVersion === "string" && /^\d+\.\d+\.\d+$/u.test(extensionVersion) ? extensionVersion : "0.1.5",
        pairedTargetKind,
        targetId: typeof targetId === "string" && /^[0-9a-f-]{36}$/iu.test(targetId) ? targetId : null,
        tabId: Number.isSafeInteger(state?.session?.tabId) ? state.session.tabId : null,
        contentReadyReceived: candidate.contentReadyReceived === true,
        contentReadyContractVersion: Number.isSafeInteger(candidate.contentReadyContractVersion) ? candidate.contentReadyContractVersion : null,
        documentFingerprint: typeof candidate.documentFingerprint === "string" && /^[0-9a-f]{8}$/u.test(candidate.documentFingerprint) ? candidate.documentFingerprint : null,
        documentGeneration: Number.isSafeInteger(candidate.documentGeneration) && candidate.documentGeneration >= 0 ? candidate.documentGeneration : 0,
        documentStatus: DOCUMENT_RESULTS.has(candidate.documentStatus) ? candidate.documentStatus : "NOT_SEEN",
        lastPingAttemptAt: typeof candidate.lastPingAttemptAt === "string" && Number.isFinite(new Date(candidate.lastPingAttemptAt).getTime()) ? candidate.lastPingAttemptAt : null,
        lastPingResult: PING_RESULTS.has(candidate.lastPingResult) ? candidate.lastPingResult : "NOT_ATTEMPTED",
        mainProbeResult: MAIN_RESULTS.has(candidate.mainProbeResult) ? candidate.mainProbeResult : pairedTargetKind === "PROFILE" ? "NOT_ATTEMPTED" : "NOT_APPLICABLE",
        currentReadinessState: safeReadinessState(candidate.currentReadinessState ?? state?.status?.phase),
        safeError: typeof candidate.safeError === "string" && /^[A-Z0-9_]{2,64}$/u.test(candidate.safeError) ? candidate.safeError : null,
      };
    }

    function immediateDiagnostic(state, pingResult) {
      const previous = diagnosticState(state);
      return diagnosticState(state, {
        lastPingAttemptAt: new Date(now()).toISOString(),
        lastPingResult: PING_RESULTS.has(pingResult) ? pingResult : "OTHER_SAFE_FAILURE",
        mainProbeResult: "NOT_ATTEMPTED",
        documentStatus: previous.documentFingerprint ? "STALE" : previous.documentStatus,
        safeError: PING_RESULTS.has(pingResult) ? pingResult : "OTHER_SAFE_FAILURE",
      });
    }

    function diagnosticPingResult(readiness) {
      if (readiness.readinessFailure === "EXTENSION_CONTEXT_INVALIDATED") return "CONTEXT_INVALIDATED";
      if (["RECEIVER_MISSING", "TAB_MISSING", "TARGET_MISMATCH", "CONTRACT_MISMATCH", "INVALID_RESPONSE"].includes(readiness.readinessFailure)) return readiness.readinessFailure;
      if (readiness.contentScriptReachable === true) return "PING_OK";
      return "OTHER_SAFE_FAILURE";
    }

    function fingerprintNonce(value) {
      let hash = 2166136261;
      for (const character of value) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619); }
      return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function safeReadinessState(value) { return typeof value === "string" && /^[A-Z0-9_]{2,64}$/u.test(value) ? value : "UNKNOWN"; }

    return { handleMessage, handleTabRemoved, handleExpiryAlarm };
  }

  function initialState() { return { session: null, armed: null, operation: null, profile: null, status: { phase: "NOT_PAIRED", message: "Not paired." } }; }
  function emptyTabState(overrides = {}) {
    return {
      tab: null, selected: null, activeTabPresent: false, tabIdPresent: false, urlPresent: false,
      isSupportedCharacterPage: false, selectedExternalIdPresent: false, queryResultCount: 0, windowId: null,
      boundTabId: null, boundTarget: null, boundTabStale: false, contentScriptReachable: null,
      observerReachable: null, activeRetrievalReachable: null, observerArmed: false, siteAccessGranted: null, runtimeError: null, readinessFailure: null, documentNonce: null, ...overrides,
    };
  }
  function safeState(state, active = null) {
    const capabilityPresent = Boolean(state.session);
    const capabilityExpired = state.status.phase === "EXPIRED";
    const activeTabPresent = active?.activeTabPresent === true;
    const tabIdPresent = active?.tabIdPresent === true;
    const isSupportedCharacterPage = active?.isSupportedCharacterPage === true;
    const selectedExternalIdPresent = active?.selectedExternalIdPresent === true;
    const targetMatches = Boolean(state.session?.target && active?.selected && root.CharacterArchiveCompanionContract.sameTarget(state.session.target, active.selected));
    const contentScriptReachable = active?.contentScriptReachable ?? (state.status.code === "CONTENT_SCRIPT_UNAVAILABLE" ? false : null);
    const observerReachable = active?.observerReachable ?? (state.status.code === "UNSUPPORTED_CAPTURE_METHOD" ? false : null);
    const activeRetrievalReachable = active?.activeRetrievalReachable ?? (state.status.code === "ACTIVE_RETRIEVAL_UNAVAILABLE" ? false : null);
    const profileRetrievalReachable = active?.profileRetrievalReachable ?? null;
    const observerArmed = active?.observerArmed === true;
    const phase = state.status.phase;
    const observerState = phase === "SENDING" ? "captured" : phase === "OBSERVER_ARMED" ? "armed" : phase === "ARMED_PENDING_PAGE" ? "pending" : "idle";
    const blockedPhase = ["ARMED_PENDING_PAGE", "OBSERVER_ARMED", "RETRIEVING", "SENDING", "SENT", "PROFILE_DISCOVERING", "PROFILE_RETRIEVING"].includes(phase);
    const selectedTargetKind = targetKind(active?.selected);
    const profileTarget = targetKind(state.session?.target ?? active?.selected) === "PROFILE";
    const sendEnabled = !profileTarget && capabilityPresent && phase === "READY" && activeTabPresent && tabIdPresent && isSupportedCharacterPage && selectedExternalIdPresent && targetMatches && active?.wrongCharacterPage !== true && contentScriptReachable === true && activeRetrievalReachable === true && !blockedPhase;
    const profileDiscoverEnabled = profileTarget && capabilityPresent && phase === "READY" && targetMatches && contentScriptReachable === true && profileRetrievalReachable === true;
    const profileRetrieveEnabled = profileTarget && capabilityPresent && phase === "PROFILE_DISCOVERED" && Boolean(state.profile?.discovered);
    const profileCancelEnabled = profileTarget && phase === "PROFILE_RETRIEVING";
    const retryEnabled = capabilityPresent && activeTabPresent && tabIdPresent && isSupportedCharacterPage && targetMatches && active?.siteAccessGranted !== false && !blockedPhase && (contentScriptReachable === false || (profileTarget ? profileRetrievalReachable === false : activeRetrievalReachable === false));
    const retrievalUnavailable = profileTarget ? profileRetrievalReachable !== true : activeRetrievalReachable !== true;
    const disabledReason = sendEnabled || profileDiscoverEnabled || profileRetrieveEnabled || profileCancelEnabled ? null : capabilityExpired ? "CAPABILITY_EXPIRED" : !capabilityPresent ? "NOT_PAIRED" : state.status.code === "BOUND_TAB_UNAVAILABLE" ? "BOUND_TAB_UNAVAILABLE" : !activeTabPresent ? "ACTIVE_TAB_UNAVAILABLE" : !tabIdPresent ? "TAB_ID_UNAVAILABLE" : !active?.urlPresent && active?.boundTabId == null ? "TAB_URL_UNAVAILABLE" : !isSupportedCharacterPage ? "WRONG_PAGE" : !targetMatches || active?.wrongCharacterPage === true ? (profileTarget ? "WRONG_PROFILE" : "WRONG_CHARACTER") : active?.siteAccessGranted === false ? "SOURCE_SITE_ACCESS_REQUIRED" : contentScriptReachable !== true ? "CONTENT_SCRIPT_UNAVAILABLE" : retrievalUnavailable ? "ACTIVE_RETRIEVAL_UNAVAILABLE" : phase === "RETRIEVING" ? "RETRIEVAL_IN_PROGRESS" : phase === "SENDING" ? "SEND_IN_PROGRESS" : "SEND_UNAVAILABLE";
    const message = capabilityPresent && state.status.code === "BOUND_TAB_UNAVAILABLE" ? state.status.message : capabilityPresent && !activeTabPresent ? "Paired, but the bound Janitor tab is unavailable." : capabilityPresent && !isSupportedCharacterPage ? "The paired tab is no longer a supported Janitor page." : capabilityPresent && !targetMatches ? (profileTarget ? "This pairing belongs to a different Janitor profile." : "This pairing belongs to a different character page.") : capabilityPresent && active?.siteAccessGranted === false ? "The extension does not have access to this source. Enable its configured site access and reload." : capabilityPresent && contentScriptReachable !== true ? "Paired. Reload this Janitor page, then Retry." : capabilityPresent && retrievalUnavailable ? "Paired, but browser-local retrieval is unavailable on this page." : phase === "NOT_PAIRED" && selectedTargetKind === "PROFILE" ? "Pair this Janitor profile to discover its characters." : phase === "NOT_PAIRED" && selectedTargetKind === "CHARACTER" ? "Pair this Janitor character to retrieve it." : state.status.message;
    return {
      ok: state.status.phase !== "ERROR", phase, code: state.status.code ?? null, message,
      expiresAt: state.session?.expiresAt ?? null, jobId: state.status.jobId ?? state.session?.jobId ?? null,
      characterName: state.status.characterName ?? null, paired: capabilityPresent, capabilityPresent,
      capabilityExpired, activeTabPresent, tabIdPresent, urlPresent: active?.urlPresent === true,
      queryResultCount: typeof active?.queryResultCount === "number" ? active.queryResultCount : null,
      windowId: typeof active?.windowId === "number" ? active.windowId : null,
      boundTabId: typeof active?.boundTabId === "number" ? active.boundTabId : null,
      boundExternalId: typeof active?.boundTarget?.externalId === "string" ? active.boundTarget.externalId : null,
      boundTabStale: active?.boundTabStale === true, isSupportedCharacterPage, selectedExternalIdPresent,
      selectedPlatform: active?.selected?.platform ?? null, selectedExternalId: active?.selected?.externalId ?? null,
      selectedProfileId: active?.selected?.profileId ?? null, selectedTargetKind,
      pairedTargetKind: targetKind(state.session?.target),
      contentScriptReachable, observerReachable, activeRetrievalReachable, profileRetrievalReachable, observerArmed, siteAccessGranted: active?.siteAccessGranted ?? null,
      runtimeError: active?.runtimeError ?? state.status.runtimeError ?? null, readinessFailure: active?.readinessFailure ?? null, observerState, sendEnabled,
      retryEnabled, retrieveEnabled: sendEnabled, profileTarget, profileDiscoverEnabled, profileRetrieveEnabled, profileCancelEnabled,
      profile: state.profile ? { discovered: state.profile.discovered, truncated: state.profile.truncated, selected: state.profile.selected, ready: state.profile.ready, failed: state.profile.failed } : null,
      disabledReason, readinessDiagnostics: safeDiagnosticDto(state.diagnostics, phase),
    };
  }
  function failure(code, message, active = null) {
    return { ...safeState({ ...initialState(), status: { phase: "ERROR", code, message } }, active), ok: false };
  }
  function safeDiagnosticDto(value, phase) {
    if (!isRecord(value)) return null;
    return {
      extensionVersion: typeof value.extensionVersion === "string" ? value.extensionVersion : null,
      pairedTargetKind: value.pairedTargetKind === "PROFILE" || value.pairedTargetKind === "CHARACTER" ? value.pairedTargetKind : null,
      targetId: typeof value.targetId === "string" && /^[0-9a-f-]{36}$/iu.test(value.targetId) ? value.targetId : null,
      tabId: Number.isSafeInteger(value.tabId) ? value.tabId : null,
      contentReadyReceived: value.contentReadyReceived === true,
      contentReadyContractVersion: Number.isSafeInteger(value.contentReadyContractVersion) ? value.contentReadyContractVersion : null,
      documentFingerprint: typeof value.documentFingerprint === "string" && /^[0-9a-f]{8}$/u.test(value.documentFingerprint) ? value.documentFingerprint : null,
      documentGeneration: Number.isSafeInteger(value.documentGeneration) ? value.documentGeneration : 0,
      documentStatus: ["NOT_SEEN", "CURRENT", "STALE"].includes(value.documentStatus) ? value.documentStatus : "NOT_SEEN",
      lastPingAttemptAt: typeof value.lastPingAttemptAt === "string" ? value.lastPingAttemptAt : null,
      lastPingResult: typeof value.lastPingResult === "string" && /^[A-Z0-9_]{2,64}$/u.test(value.lastPingResult) ? value.lastPingResult : "NOT_ATTEMPTED",
      mainProbeResult: typeof value.mainProbeResult === "string" && /^[A-Z0-9_]{2,64}$/u.test(value.mainProbeResult) ? value.mainProbeResult : "NOT_ATTEMPTED",
      currentReadinessState: typeof phase === "string" && /^[A-Z0-9_]{2,64}$/u.test(phase) ? phase : "UNKNOWN",
      safeError: typeof value.safeError === "string" && /^[A-Z0-9_]{2,64}$/u.test(value.safeError) ? value.safeError : null,
    };
  }
  function targetKind(target) {
    if (target?.targetKind === "CHARACTER" && typeof target.externalId === "string") return "CHARACTER";
    if (target?.targetKind === "PROFILE" && typeof target.profileId === "string") return "PROFILE";
    return null;
  }
  function targetMismatch(target, supportedPage) {
    if (!supportedPage) return { code: "WRONG_PAGE", message: "The paired tab is no longer a supported Janitor page." };
    if (targetKind(target) === "PROFILE") return { code: "WRONG_PROFILE", message: "This pairing belongs to a different Janitor profile." };
    if (targetKind(target) === "CHARACTER") return { code: "WRONG_CHARACTER", message: "This pairing belongs to a different character page." };
    return { code: "INVALID_PAIRING_TARGET", message: "The pairing target is invalid or incompatible. Create a fresh pairing." };
  }
  function isPopupSender(sender, runtimeId) { return sender?.id === runtimeId && sender?.url === `chrome-extension://${runtimeId}/popup.html` && !sender.tab; }
  function contentSender(sender, runtimeId, contract) {
    if (sender?.id !== runtimeId || !sender.tab || typeof sender.tab.id !== "number" || typeof sender.url !== "string") return null;
    const selected = contract.matchPage(sender.url);
    return selected ? { tabId: sender.tab.id, selected } : null;
  }
  function exactKeys(value, keys) { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }
  async function readResponseObject(response) { try { const value = await response.json(); return isRecord(value) ? value : {}; } catch { return {}; } }
  function safeErrorCode(body) { return isRecord(body.error) && typeof body.error.code === "string" && /^[A-Z0-9_]{2,64}$/u.test(body.error.code) ? body.error.code : null; }
  function pairingErrorMessage(code) {
    if (code === "PAIRING_EXPIRED") return "Pairing expired. Create a new one-time code.";
    if (code === "PAIRING_ALREADY_USED") return "This pairing code was already used.";
    if (code === "PAIRING_RATE_LIMITED") return "Too many pairing attempts. Wait before trying again.";
    if (code === "WRONG_PROFILE") return "This pairing belongs to a different Janitor profile.";
    if (code === "WRONG_CHARACTER") return "This pairing belongs to a different character page.";
    if (code === "INVALID_PAIRING_TARGET") return "The pairing target is invalid or incompatible. Create a fresh pairing.";
    if (code === "COMPANION_ORIGIN_NOT_ALLOWED") return "This extension ID is not configured in Character Archive.";
    return "Pairing failed. Create a new one-time code and try again.";
  }
  function importErrorMessage(code) {
    if (code === "CAPABILITY_EXPIRED") return "Capability expired. Create a new one-time pairing.";
    if (code === "WRONG_CHARACTER") return "The captured character does not match the paired target.";
    if (code === "SOURCE_CONTRACT_CHANGED") return "The source contract changed. Capture is temporarily unavailable.";
    return "Character Archive rejected the selected source payload.";
  }
  function contentUnavailableState(state, runtimeError = null) { return { ...state, status: { phase: "PAIRED_PAGE_RELOAD_REQUIRED", code: "CONTENT_SCRIPT_UNAVAILABLE", message: "Paired. Reload this Janitor page, then Retry.", runtimeError } }; }
  function observerUnavailableState(state) { return { ...state, status: { phase: "PAIRED", code: "UNSUPPORTED_CAPTURE_METHOD", message: "Paired, but this page does not expose a supported capture method." } }; }
  function activeRetrievalUnavailableState(state) { return { ...state, status: { phase: "PAIRED_PAGE_RELOAD_REQUIRED", code: "ACTIVE_RETRIEVAL_UNAVAILABLE", message: "Paired, but browser-local retrieval is unavailable on this page. Reload the page, then Retry." } }; }
  function retrievalErrorMessage(code) {
    if (code === "AUTH_REQUIRED") return "Janitor authentication is unavailable in this page. Sign in to Janitor and try again.";
    if (code === "NOT_FOUND") return "Janitor could not find the selected character.";
    if (code === "RATE_LIMITED") return "Janitor is rate limiting retrieval. Wait a moment and try again.";
    if (code === "RETRIEVAL_TIMEOUT") return "Janitor retrieval timed out after bounded retries.";
    if (code === "SOURCE_CONTRACT_CHANGED") return "Janitor's character response contract is not currently supported.";
    if (code === "INVALID_SOURCE_PAYLOAD") return "Janitor returned character data that did not pass validation.";
    if (code === "CANCELLED") return "A retrieval is already in progress for this character.";
    return "Janitor retrieval is temporarily unavailable.";
  }
  function profileFailureStatus(code) { if (code === "AUTH_REQUIRED") return "AUTH_REQUIRED"; if (code === "NOT_FOUND") return "NOT_FOUND"; if (code === "RATE_LIMITED") return "RATE_LIMITED"; if (code === "INVALID_SOURCE_PAYLOAD" || code === "SOURCE_CONTRACT_CHANGED") return "INVALID_PAYLOAD"; if (code === "CANCELLED") return "CANCELLED"; return "FAILED"; }
  function safeRuntimeError(error, response) {
    const message = error instanceof Error ? error.message : isRecord(error) && typeof error.message === "string" ? error.message : response === undefined ? "No content-script response was returned." : "The content-script response was invalid.";
    const normalized = message.replace(/\s+/gu, " ").trim();
    return normalized ? normalized.slice(0, 180) : null;
  }
  function classifySendMessageFailure(error) {
    const message = safeRuntimeError(error) ?? "";
    if (/receiving end does not exist|could not establish connection|message port closed/iu.test(message)) return "RECEIVER_MISSING";
    if (/no tab with id|tab (?:was not found|does not exist)/iu.test(message)) return "TAB_MISSING";
    if (/frame .*?(?:not found|does not exist)|wrong frame/iu.test(message)) return "WRONG_FRAME";
    if (/extension context invalidated/iu.test(message)) return "EXTENSION_CONTEXT_INVALIDATED";
    return "INVALID_RESPONSE";
  }
  function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

  root.CharacterArchiveCompanionBackground = Object.freeze({ STATE_KEY, EXPIRY_ALARM, createBackgroundController });
})(globalThis);
