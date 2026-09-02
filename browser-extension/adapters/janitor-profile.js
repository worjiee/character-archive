(function installJanitorProfileAdapter(root) {
  "use strict";
  const registry = root.CharacterArchiveActiveAdapterRegistry;
  const observer = root.CharacterArchiveObserverRegistry?.get?.("JANITOR_AI");
  const active = root.CharacterArchiveJanitorActiveAdapter;
  const contract = root.CharacterArchiveCompanionContract;
  const PROFILE_DISCOVERY_MAX = 100;
  const PROFILE_DISCOVERY_PAGE_MAX = 20;
  const JANITOR_DETAIL_CONCURRENCY = 2;
  const ATTEMPTS = 3;
  const ATTEMPT_TIMEOUT_MS = 10_000;
  const OVERALL_TIMEOUT_MS = 30_000;
  if (!registry || !observer || !active || !contract) return;

  function createAdapter(dependencies = {}) {
    const fetchImpl = dependencies.fetchImpl ?? ((...args) => root.fetch(...args));
    const readCookie = dependencies.readCookie ?? (() => root.document?.cookie ?? "");
    const decodeBase64 = dependencies.decodeBase64 ?? ((value) => root.atob(value));
    const now = dependencies.now ?? Date.now;
    const wait = dependencies.wait ?? ((milliseconds) => new Promise((resolve) => root.setTimeout(resolve, milliseconds)));
    const setTimer = dependencies.setTimer ?? root.setTimeout.bind(root);
    const clearTimer = dependencies.clearTimer ?? root.clearTimeout.bind(root);
    const AbortControllerImpl = dependencies.AbortControllerImpl ?? root.AbortController;
    const rateGate = createRateGate(now, wait);
    const activeControllers = new Set();
    const detailAdapter = active.createAdapter({
      ...dependencies, fetchImpl, readCookie, decodeBase64, rateGate,
      cancellationRequested: () => cancelled,
      onControllerStart: (controller) => activeControllers.add(controller),
      onControllerFinish: (controller) => activeControllers.delete(controller),
    });
    let discoveredIds = new Set();
    let cancelled = false;

    async function discoverProfile(target) {
      if (!isProfileTarget(target)) return failed("WRONG_PROFILE");
      let authorization = null;
      const items = []; const seen = new Set(); let page = 1; let reportedTotal = null; let reachedPageBound = false; cancelled = false;
      try {
        authorization = active.resolveAuthorization(readCookie(), decodeBase64);
        if (!authorization) return failed("AUTH_REQUIRED");
        while (items.length < PROFILE_DISCOVERY_MAX && page <= PROFILE_DISCOVERY_PAGE_MAX && !cancelled) {
          const endpoint = new URL("https://janitorai.com/hampter/characters");
          endpoint.searchParams.set("page", String(page)); endpoint.searchParams.set("language", "en");
          endpoint.searchParams.set("sort", "latest"); endpoint.searchParams.append("user_id[]", target.profileId);
          const pageResult = await retrieveListingPage(endpoint, authorization);
          if (pageResult.status !== "RETRIEVED") return pageResult;
          const body = pageResult.payload;
          if (Number.isSafeInteger(body.total) && body.total >= 0) reportedTotal = body.total;
          if (body.data.length === 0) break;
          for (const raw of body.data) {
            const item = listingItem(raw); if (!item || seen.has(item.externalId)) continue;
            seen.add(item.externalId); items.push(item); if (items.length === PROFILE_DISCOVERY_MAX) break;
          }
          page += 1;
          if (reportedTotal !== null && seen.size >= reportedTotal) break;
        }
        reachedPageBound = page > PROFILE_DISCOVERY_PAGE_MAX;
        discoveredIds = new Set(items.map((item) => item.externalId));
        if (cancelled) return failed("CANCELLED");
        return { status: "DISCOVERED", items, reportedTotal, truncated: reachedPageBound || (items.length === PROFILE_DISCOVERY_MAX && (reportedTotal === null || reportedTotal > items.length)) };
      } finally { authorization = null; }
    }

    async function retrieveListingPage(endpoint, authorization) {
      const startedAt = now(); let last = failed("SOURCE_UNAVAILABLE");
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        if (cancelled) return failed("CANCELLED");
        await rateGate.wait();
        const remaining = OVERALL_TIMEOUT_MS - (now() - startedAt); if (remaining <= 0) return failed("RETRIEVAL_TIMEOUT");
        const controller = new AbortControllerImpl(); activeControllers.add(controller); let timedOut = false;
        const timer = setTimer(() => { timedOut = true; controller.abort(); }, Math.min(ATTEMPT_TIMEOUT_MS, remaining));
        try {
          const response = await fetchImpl(endpoint.href, { method: "GET", headers: { Accept: "application/json, text/plain, */*", Authorization: authorization }, credentials: "include", cache: "no-store", redirect: "manual", referrerPolicy: "same-origin", signal: controller.signal });
          const result = await classifyListingResponse(response, endpoint);
          if (result.code === "RATE_LIMITED") rateGate.pause(result.retryAfterMs);
          if (result.status === "RETRIEVED" || !result.retryable) return result;
          last = result; if (attempt === ATTEMPTS - 1) return failed(result.code);
          const delay = retryDelay(result.retryAfterMs, attempt, OVERALL_TIMEOUT_MS - (now() - startedAt));
          if (delay === null) return failed(result.code); await wait(delay);
        } catch (error) {
          if (cancelled) return failed("CANCELLED");
          const retryable = timedOut || retryableNetwork(error); last = failed(timedOut ? "RETRIEVAL_TIMEOUT" : "SOURCE_UNAVAILABLE");
          if (!retryable || attempt === ATTEMPTS - 1) return last;
        } finally { clearTimer(timer); activeControllers.delete(controller); }
      }
      return last;
    }

    async function classifyListingResponse(response, endpoint) {
      if (!response || typeof response.status !== "number") return failed("SOURCE_UNAVAILABLE");
      if (response.url && !sameListingUrl(response.url, endpoint)) return failed("SOURCE_CONTRACT_CHANGED");
      if (response.status >= 300 && response.status < 400) return failed("SOURCE_CONTRACT_CHANGED");
      if (response.status === 401 || response.status === 403) return failed("AUTH_REQUIRED");
      if (response.status === 429) return { ...failed("RATE_LIMITED"), retryable: true, retryAfterMs: retryAfter(response.headers?.get?.("retry-after")) };
      if ([502, 503, 504].includes(response.status)) return { ...failed("SOURCE_UNAVAILABLE"), retryable: true };
      if (response.status !== 200 || !String(response.headers?.get?.("content-type") ?? "").toLowerCase().includes("json")) return failed("SOURCE_CONTRACT_CHANGED");
      const text = await response.text(); if (new TextEncoder().encode(text).byteLength > contract.MAX_CHARACTER_BYTES) return failed("INVALID_SOURCE_PAYLOAD");
      let payload; try { payload = JSON.parse(text); } catch { return failed("INVALID_SOURCE_PAYLOAD"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Array.isArray(payload.data) || contract.containsForbiddenTransportData(payload)) return failed("INVALID_SOURCE_PAYLOAD");
      return { status: "RETRIEVED", payload };
    }

    async function retrieveSelected(target, selectedIds, onResult) {
      if (!isProfileTarget(target)) return failed("WRONG_PROFILE");
      if (!Array.isArray(selectedIds) || selectedIds.some((id) => typeof id !== "string" || !discoveredIds.has(id))) return failed("UNDISCOVERED_CHARACTER");
      cancelled = false; let cursor = 0;
      async function worker() {
        while (!cancelled) {
          const index = cursor++; if (index >= selectedIds.length) return;
          const externalId = selectedIds[index];
          const characterTarget = { targetKind: "CHARACTER", platform: "JANITOR_AI", externalId, canonicalSourceUrl: `https://janitorai.com/characters/${externalId}`, pageOrigin: target.pageOrigin };
          const result = await detailAdapter.retrieveCharacter(characterTarget);
          await onResult(externalId, result);
        }
      }
      await Promise.all(Array.from({ length: Math.min(JANITOR_DETAIL_CONCURRENCY, selectedIds.length) }, worker));
      return { status: cancelled ? "CANCELLED" : "COMPLETE" };
    }
    function cancel() { cancelled = true; for (const controller of activeControllers) controller.abort(); }
    return Object.freeze({ key: "JANITOR_AI:PROFILE", platform: "JANITOR_AI", contractVersion: 1, allowedOrigins: observer.allowedOrigins,
      matchesPage(value) { const target = observer.matchesProfilePage?.(value); return isProfileTarget(target) ? target : null; },
      preflightPayload: observer.preflightPayload, discoverProfile, retrieveSelected, cancel });
  }

  function createRateGate(now, wait) { let until = 0; return { pause(milliseconds) { until = Math.max(until, now() + Math.min(Number.isFinite(milliseconds) ? milliseconds : 1000, 5000)); }, async wait() { const delay = until - now(); if (delay > 0) await wait(delay); } }; }
  function listingItem(value) { if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.id) || typeof value.name !== "string" || !value.name.trim()) return null; return { externalId: value.id.toLowerCase(), name: value.name.trim().slice(0, 200), avatarUrl: clean(value.avatar), creatorName: clean(value.creator_name), createdAt: date(value.created_at), updatedAt: date(value.updated_at) }; }
  function clean(value) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 2048) : null; }
  function date(value) { return typeof value === "string" && Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() : null; }
  function isProfileTarget(value) { return value && typeof value === "object" && value.targetKind === "PROFILE" && typeof value.profileId === "string" && typeof value.canonicalProfileUrl === "string"; }
  function failed(code) { return { status: "FAILED", code }; }
  function sameListingUrl(value, expected) { try { const actual = new URL(value); return actual.origin === expected.origin && actual.pathname === expected.pathname && actual.searchParams.get("page") === expected.searchParams.get("page") && actual.searchParams.get("language") === "en" && actual.searchParams.get("sort") === "latest" && actual.searchParams.getAll("user_id[]").length === 1 && actual.searchParams.get("user_id[]") === expected.searchParams.get("user_id[]"); } catch { return false; } }
  function retryAfter(value) { if (typeof value !== "string" || !value.trim()) return null; const seconds = Number(value); if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000); const timestamp = Date.parse(value); return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null; }
  function retryDelay(retryAfterMs, attempt, remaining) { const proposed = Number.isFinite(retryAfterMs) ? retryAfterMs : 250 * (2 ** attempt); return proposed >= 0 && proposed < remaining ? Math.min(proposed, 2000) : null; }
  function retryableNetwork(error) { const message = error instanceof Error ? error.message : ""; return error?.name === "AbortError" || /connection reset|timed out|socket hang up|networkerror|failed to fetch/iu.test(message); }
  const defaultAdapter = createAdapter(); registry.register(defaultAdapter);
  root.CharacterArchiveJanitorProfileAdapter = Object.freeze({ createAdapter, PROFILE_DISCOVERY_MAX, PROFILE_DISCOVERY_PAGE_MAX, JANITOR_DETAIL_CONCURRENCY });
})(globalThis);
