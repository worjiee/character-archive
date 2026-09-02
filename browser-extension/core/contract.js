(function installCharacterArchiveCompanionContract(root) {
  "use strict";

  const registry = root.CharacterArchiveObserverRegistry;
  const CHANNEL = "CHARACTER_ARCHIVE_COMPANION";
  const VERSION = 1;
  const MAX_CHARACTER_BYTES = 1024 * 1024;
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const ARM_NONCE = /^[0-9a-f]{32}$/u;
  const TARGET_KEYS = new Set(["targetKind", "platform", "externalId", "canonicalSourceUrl", "pageOrigin"]);
  const PROFILE_TARGET_KEYS = new Set(["targetKind", "platform", "profileId", "canonicalProfileUrl", "pageOrigin"]);
  const FORBIDDEN_KEYS = new Set([
    "authorization", "bearer", "bearertoken", "headers", "cookie", "cookies", "setcookie",
    "accesstoken", "refreshtoken", "session", "sessionid", "sessiontoken", "token",
    "apikey", "password", "clientsecret", "secretkey", "localstorage", "sessionstorage",
    "indexeddb", "cloudflare", "cloudflarestate", "cfclearance",
  ]);
  const PAGE_CAPTURE_KEYS = new Set([
    "channel", "version", "type", "armNonce", "messageId", "capturedAt",
    "target", "observerContractVersion", "payload",
  ]);
  const FORWARDED_CAPTURE_KEYS = new Set([
    "messageId", "capturedAt", "target", "observerContractVersion", "payload",
  ]);
  const RETRIEVAL_ERROR_CODES = new Set([
    "AUTH_REQUIRED", "NOT_FOUND", "RATE_LIMITED", "RETRIEVAL_TIMEOUT", "SOURCE_UNAVAILABLE",
    "INVALID_SOURCE_PAYLOAD", "SOURCE_CONTRACT_CHANGED", "WRONG_CHARACTER", "CAPABILITY_EXPIRED", "CANCELLED",
  ]);

  function matchPage(value) {
    if (!registry || typeof registry.resolvePage !== "function") return null;
    return registry.resolveTarget?.(value)?.target ?? registry.resolvePage(value)?.target ?? null;
  }
  function validateTarget(value) {
    if (!isRecord(value)) return null;
    if (hasOnlyKeys(value, PROFILE_TARGET_KEYS) && Object.keys(value).length === PROFILE_TARGET_KEYS.size) {
      if (value.targetKind !== "PROFILE" || value.platform !== "JANITOR_AI" || typeof value.profileId !== "string" || typeof value.canonicalProfileUrl !== "string" || typeof value.pageOrigin !== "string") return null;
      const observer = registry?.get?.("JANITOR_AI");
      const canonical = observer?.matchesProfilePage?.(value.canonicalProfileUrl);
      if (!observer?.allowedOrigins?.includes?.(value.pageOrigin) || !canonical || canonical.profileId !== value.profileId || canonical.canonicalProfileUrl !== value.canonicalProfileUrl) return null;
      return { targetKind: value.targetKind, platform: value.platform, profileId: value.profileId, canonicalProfileUrl: value.canonicalProfileUrl, pageOrigin: value.pageOrigin };
    }
    if (!hasOnlyKeys(value, TARGET_KEYS) || Object.keys(value).length !== TARGET_KEYS.size) return null;
    if (value.targetKind !== "CHARACTER" || typeof value.platform !== "string" || typeof value.externalId !== "string" || typeof value.canonicalSourceUrl !== "string" || typeof value.pageOrigin !== "string") return null;
    if (!registry || typeof registry.get !== "function") return null;
    const observer = registry.get(value.platform);
    if (!observer || !observer.allowedOrigins.includes(value.pageOrigin)) return null;
    const canonical = observer.matchesPage(value.canonicalSourceUrl);
    if (!canonical || canonical.externalId !== value.externalId || canonical.canonicalSourceUrl !== value.canonicalSourceUrl) return null;
    return { targetKind: value.targetKind, platform: value.platform, externalId: value.externalId, canonicalSourceUrl: value.canonicalSourceUrl, pageOrigin: value.pageOrigin };
  }
  function sameTarget(left, right) {
    const a = validateTarget(left);
    const b = validateTarget(right);
    if (!a || !b) return false;
    if (a.targetKind === "CHARACTER" && b.targetKind === "CHARACTER") return [...TARGET_KEYS].every((key) => a[key] === b[key]);
    if (a.targetKind === "PROFILE" && b.targetKind === "PROFILE") return [...PROFILE_TARGET_KEYS].every((key) => a[key] === b[key]);
    return false;
  }
  function validateArmMessage(value, expectedTarget) {
    if (!isRecord(value) || !hasExactKeys(value, ["channel", "version", "type", "armNonce", "target"])) return null;
    if (value.channel !== CHANNEL || value.version !== VERSION || value.type !== "ARM_SELECTED_TARGET" || typeof value.armNonce !== "string" || !ARM_NONCE.test(value.armNonce) || !sameTarget(value.target, expectedTarget)) return null;
    return { armNonce: value.armNonce, target: validateTarget(expectedTarget) };
  }
  function validateActiveRetrievalPing(value, expectedTarget) {
    if (!isRecord(value) || !hasExactKeys(value, ["channel", "version", "type", "activeNonce", "target"])) return null;
    if (value.channel !== CHANNEL || value.version !== VERSION || value.type !== "ACTIVE_RETRIEVAL_PING" || typeof value.activeNonce !== "string" || !ARM_NONCE.test(value.activeNonce) || !sameTarget(value.target, expectedTarget)) return null;
    return { activeNonce: value.activeNonce, target: validateTarget(expectedTarget) };
  }
  function validateRetrievalMessage(value, expectedTarget) {
    if (!isRecord(value) || !hasExactKeys(value, ["channel", "version", "type", "operationNonce", "target"])) return null;
    if (value.channel !== CHANNEL || value.version !== VERSION || value.type !== "RETRIEVE_SELECTED_CHARACTER" || typeof value.operationNonce !== "string" || !ARM_NONCE.test(value.operationNonce) || !sameTarget(value.target, expectedTarget)) return null;
    return { operationNonce: value.operationNonce, target: validateTarget(expectedTarget) };
  }
  function validatePageRetrievalResult(value, currentPageUrl, expectedOperationNonce) {
    const selected = matchPage(currentPageUrl);
    if (!selected || !isRecord(value) || value.channel !== CHANNEL || value.version !== VERSION || value.type !== "ACTIVE_RETRIEVAL_RESULT" || value.operationNonce !== expectedOperationNonce || !sameTarget(value.target, selected)) return null;
    if (value.status === "FAILED") {
      if (!hasExactKeys(value, ["channel", "version", "type", "operationNonce", "target", "status", "code"]) || !isRetrievalErrorCode(value.code)) return null;
      return { status: "FAILED", code: value.code, target: selected };
    }
    if (value.status !== "RETRIEVED" || !hasExactKeys(value, ["channel", "version", "type", "operationNonce", "target", "status", "observerContractVersion", "payload"])) return null;
    const observer = registry?.get?.(selected.platform);
    if (!observer || value.observerContractVersion !== observer.contractVersion || !isRecord(value.payload) || !observer.preflightPayload(value.payload, selected) || containsForbiddenTransportData(value.payload)) return null;
    let encoded;
    try { encoded = new TextEncoder().encode(JSON.stringify(value.payload)); } catch { return null; }
    if (encoded.byteLength > MAX_CHARACTER_BYTES) return null;
    return { status: "RETRIEVED", observerContractVersion: value.observerContractVersion, payload: value.payload, target: selected };
  }
  function validatePageCaptureMessage(value, currentPageUrl, expectedArmNonce) {
    if (!isRecord(value) || !hasOnlyKeys(value, PAGE_CAPTURE_KEYS) || Object.keys(value).length !== PAGE_CAPTURE_KEYS.size) return null;
    const selected = matchPage(currentPageUrl);
    if (!selected || value.channel !== CHANNEL || value.version !== VERSION || value.type !== "SOURCE_CHARACTER_CAPTURED" || value.armNonce !== expectedArmNonce) return null;
    return validateCaptureFields(value, selected);
  }
  function validateForwardedCapture(value, selected) {
    if (!isRecord(value) || !hasOnlyKeys(value, FORWARDED_CAPTURE_KEYS) || Object.keys(value).length !== FORWARDED_CAPTURE_KEYS.size) return null;
    return validateCaptureFields(value, selected);
  }
  function validateCaptureFields(value, selected) {
    const target = validateTarget(value.target);
    if (!target || !("externalId" in target)) return null;
    const observer = target ? registry.get(target.platform) : null;
    if (!target || !sameTarget(target, selected) || !observer || value.observerContractVersion !== observer.contractVersion ||
      typeof value.messageId !== "string" || !UUID_V4.test(value.messageId) || typeof value.capturedAt !== "string" ||
      !Number.isFinite(new Date(value.capturedAt).getTime()) || !isRecord(value.payload) ||
      !observer.preflightPayload(value.payload, target) || containsForbiddenTransportData(value.payload)) return null;
    let encoded;
    try { encoded = new TextEncoder().encode(JSON.stringify(value.payload)); } catch { return null; }
    if (encoded.byteLength > MAX_CHARACTER_BYTES) return null;
    return { messageId: value.messageId, capturedAt: value.capturedAt, target, observerContractVersion: value.observerContractVersion, payload: value.payload };
  }
  function createBridgeEnvelope(capture) {
    return {
      bridgeVersion: VERSION,
      observerContractVersion: capture.observerContractVersion,
      messageId: capture.messageId,
      platform: capture.target.platform,
      type: "CHARACTER",
      capturedAt: capture.capturedAt,
      source: { url: capture.target.canonicalSourceUrl },
      payload: capture.payload,
    };
  }
  function containsForbiddenTransportData(value, seen = new Set()) {
    if (!value || typeof value !== "object") return false;
    if (seen.has(value)) return true;
    seen.add(value);
    if (Array.isArray(value)) return value.some((entry) => containsForbiddenTransportData(entry, seen));
    for (const [key, nested] of Object.entries(value)) {
      const normalized = key.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/gu, "");
      if (FORBIDDEN_KEYS.has(normalized) || containsForbiddenTransportData(nested, seen)) return true;
    }
    return false;
  }
  function createNonce(cryptoObject = root.crypto) {
    const bytes = new Uint8Array(16);
    cryptoObject.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  function isRetrievalErrorCode(value) { return typeof value === "string" && RETRIEVAL_ERROR_CODES.has(value); }
  function hasOnlyKeys(value, allowed) { return Object.keys(value).every((key) => allowed.has(key)); }
  function hasExactKeys(value, expected) { return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key)); }
  function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }

  root.CharacterArchiveCompanionContract = Object.freeze({
    CHANNEL, VERSION, MAX_CHARACTER_BYTES, matchPage, validateTarget, sameTarget, validateArmMessage,
    validatePageCaptureMessage, validateForwardedCapture, createBridgeEnvelope,
    validateActiveRetrievalPing, validateRetrievalMessage, validatePageRetrievalResult,
    containsForbiddenTransportData, createNonce, isRetrievalErrorCode,
  });
})(globalThis);
