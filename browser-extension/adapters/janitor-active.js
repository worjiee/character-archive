(function installJanitorActiveAdapter(root) {
  "use strict";

  const registry = root.CharacterArchiveActiveAdapterRegistry;
  const observers = root.CharacterArchiveObserverRegistry;
  const contract = root.CharacterArchiveCompanionContract;
  const observer = observers?.get?.("JANITOR_AI");
  const ENDPOINT_ORIGIN = "https://janitorai.com";
  const AUTH_COOKIE = "sb-auth-auth-token";
  const ATTEMPTS = 3;
  const ATTEMPT_TIMEOUT_MS = 10_000;
  const OVERALL_TIMEOUT_MS = 30_000;

  if (!registry || !observer || !contract) return;

  function createAdapter(dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl ?? ((...args) => root.fetch(...args));
    const readCookie = dependencies.readCookie ?? (() => root.document?.cookie ?? "");
    const decodeBase64 = dependencies.decodeBase64 ?? ((value) => root.atob(value));
    const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => root.setTimeout(resolve, milliseconds)));
    const now = dependencies.now ?? Date.now;
    const setTimer = dependencies.setTimer ?? root.setTimeout.bind(root);
    const clearTimer = dependencies.clearTimer ?? root.clearTimeout.bind(root);
    const AbortControllerImpl = dependencies.AbortControllerImpl ?? root.AbortController;
    const attemptTimeoutMs = dependencies.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS;
    const overallTimeoutMs = dependencies.overallTimeoutMs ?? OVERALL_TIMEOUT_MS;
    const rateGate = dependencies.rateGate ?? null;
    const cancellationRequested = dependencies.cancellationRequested ?? (() => false);
    const onControllerStart = dependencies.onControllerStart ?? (() => undefined);
    const onControllerFinish = dependencies.onControllerFinish ?? (() => undefined);

    async function retrieveCharacter(target) {
      const canonical = observer.matchesPage(target?.canonicalSourceUrl);
      if (!canonical || !contract.sameTarget(canonical, target)) return failed("WRONG_CHARACTER");
      const endpoint = `${ENDPOINT_ORIGIN}/hampter/characters/${encodeURIComponent(canonical.externalId)}`;
      const startedAt = now();
      let authorization = null;
      try {
        if (cancellationRequested()) return failed("CANCELLED");
        authorization = resolveAuthorization(readCookie(), decodeBase64);
        if (!authorization) return failed("AUTH_REQUIRED");
        let lastFailure = failed("SOURCE_UNAVAILABLE");
        for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
          if (cancellationRequested()) return failed("CANCELLED");
          if (rateGate?.wait) await rateGate.wait();
          const remaining = overallTimeoutMs - (now() - startedAt);
          if (remaining <= 0) return failed("RETRIEVAL_TIMEOUT");
          const controller = new AbortControllerImpl();
          onControllerStart(controller);
          let timedOut = false;
          const timer = setTimer(() => { timedOut = true; controller.abort(); }, Math.min(attemptTimeoutMs, remaining));
          try {
            const response = await fetchImpl(endpoint, {
              method: "GET",
              headers: { Accept: "application/json, text/plain, */*", Authorization: authorization },
              credentials: "include",
              cache: "no-store",
              redirect: "manual",
              referrerPolicy: "same-origin",
              signal: controller.signal,
            });
            const responseResult = await classifyResponse(response, canonical, endpoint);
            if (responseResult.code === "RATE_LIMITED" && rateGate?.pause) rateGate.pause(responseResult.retryAfterMs);
            if (responseResult.status === "RETRIEVED" || !responseResult.retryable) return responseResult;
            if (attempt === ATTEMPTS - 1) return failed(responseResult.code);
            lastFailure = responseResult;
            const delay = boundedRetryDelay(responseResult.retryAfterMs, attempt, overallTimeoutMs - (now() - startedAt));
            if (delay === null) return responseResult;
            await wait(delay);
          } catch (error) {
            if (cancellationRequested()) return failed("CANCELLED");
            const code = timedOut ? "RETRIEVAL_TIMEOUT" : isRetryableNetworkError(error) ? "SOURCE_UNAVAILABLE" : "SOURCE_UNAVAILABLE";
            lastFailure = { ...failed(code), retryable: timedOut || isRetryableNetworkError(error) };
            if (!lastFailure.retryable || attempt === ATTEMPTS - 1) return failed(code);
          } finally {
            clearTimer(timer);
            onControllerFinish(controller);
          }
        }
        return lastFailure;
      } finally {
        authorization = null;
      }
    }

    async function classifyResponse(response, target, endpoint) {
      if (!response || typeof response.status !== "number") return failed("SOURCE_UNAVAILABLE");
      if (response.url) {
        try {
          const responseUrl = new URL(response.url);
          const expectedUrl = new URL(endpoint);
          if (responseUrl.origin !== expectedUrl.origin || responseUrl.pathname !== expectedUrl.pathname) return failed("SOURCE_CONTRACT_CHANGED");
        } catch { return failed("SOURCE_CONTRACT_CHANGED"); }
      }
      if (response.status >= 300 && response.status < 400) return failed("SOURCE_CONTRACT_CHANGED");
      if (response.status === 401 || response.status === 403) return failed("AUTH_REQUIRED");
      if (response.status === 404) return failed("NOT_FOUND");
      if (response.status === 429) return { ...failed("RATE_LIMITED"), retryable: true, retryAfterMs: parseRetryAfter(response.headers?.get?.("retry-after")) };
      if ([502, 503, 504].includes(response.status)) return { ...failed("SOURCE_UNAVAILABLE"), retryable: true };
      if (response.status !== 200) return failed("SOURCE_UNAVAILABLE");
      const contentType = response.headers?.get?.("content-type")?.toLowerCase?.() ?? "";
      if (!contentType.includes("application/json") && !contentType.includes("+json")) return failed("SOURCE_CONTRACT_CHANGED");
      const body = await readBoundedText(response, contract.MAX_CHARACTER_BYTES);
      if (!body.ok) return failed("INVALID_SOURCE_PAYLOAD");
      let payload;
      try { payload = JSON.parse(body.text); } catch { return failed("INVALID_SOURCE_PAYLOAD"); }
      if (!isPlainRecord(payload) || !observer.preflightPayload(payload, target) || contract.containsForbiddenTransportData(payload)) return failed("INVALID_SOURCE_PAYLOAD");
      return { status: "RETRIEVED", payload };
    }

    return Object.freeze({
      platform: "JANITOR_AI",
      contractVersion: observer.contractVersion,
      allowedOrigins: observer.allowedOrigins,
      matchesPage(value) {
        const target = observer.matchesPage(value);
        return typeof target?.externalId === "string" ? target : null;
      },
      preflightPayload: observer.preflightPayload,
      retrieveCharacter,
    });
  }

  function resolveAuthorization(cookieString, decodeBase64) {
    if (typeof cookieString !== "string" || cookieString.length > 128 * 1024) return null;
    const single = [];
    const chunks = [];
    for (const item of cookieString.split(";")) {
      const separator = item.indexOf("=");
      if (separator < 1) continue;
      const name = item.slice(0, separator).trim();
      let value = item.slice(separator + 1).trim();
      try { value = decodeURIComponent(value); } catch { /* Keep the original value. */ }
      if (name === AUTH_COOKIE) single.push(value);
      const chunk = new RegExp(`^${AUTH_COOKIE.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\.(\\d+)$`, "u").exec(name);
      if (chunk) chunks.push({ index: Number(chunk[1]), value });
    }
    chunks.sort((left, right) => left.index - right.index);
    if (chunks.some((chunk, index) => chunk.index !== index)) return null;
    let encoded = single[0] || chunks.map(({ value }) => value).join("");
    if (!encoded || encoded.length > 64 * 1024) return null;
    if (encoded.startsWith("base64-")) encoded = encoded.slice(7);
    let decoded;
    try { decoded = JSON.parse(decodeBase64(encoded)); } catch { return null; }
    const accessToken = typeof decoded?.access_token === "string"
      ? decoded.access_token
      : typeof decoded?.currentSession?.access_token === "string"
        ? decoded.currentSession.access_token
        : Array.isArray(decoded) && typeof decoded[0] === "string" ? decoded[0] : null;
    if (!accessToken || accessToken.length > 32 * 1024 || /[\u0000-\u001f\u007f]/u.test(accessToken)) return null;
    return `Bearer ${accessToken}`;
  }

  async function readBoundedText(response, maximum) {
    const declared = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declared) && declared > maximum) return { ok: false };
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maximum) { await reader.cancel(); return { ok: false }; }
        chunks.push(value);
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return { ok: true, text: new TextDecoder().decode(bytes) };
    }
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength <= maximum ? { ok: true, text } : { ok: false };
  }

  function boundedRetryDelay(retryAfterMs, attempt, remaining) {
    const proposed = Number.isFinite(retryAfterMs) ? retryAfterMs : 250 * (2 ** attempt);
    if (proposed < 0 || proposed >= remaining) return null;
    return Math.min(proposed, 2_000);
  }
  function parseRetryAfter(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
  }
  function isRetryableNetworkError(error) {
    const message = error instanceof Error ? error.message : "";
    return /connection reset|timed out|socket hang up|networkerror|failed to fetch/iu.test(message) || error?.name === "AbortError";
  }
  function failed(code) { return { status: "FAILED", code }; }
  function isPlainRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  const defaultAdapter = createAdapter();
  registry.register(defaultAdapter);
  root.CharacterArchiveJanitorActiveAdapter = Object.freeze({ createAdapter, resolveAuthorization });
})(globalThis);
