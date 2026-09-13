const DEBOUNCE_WINDOW_MS = 60_000;
const lastViewMap = new Map<string, number>();

/**
 * Checks whether a view for the given characterId should be recorded.
 * Uses an in-memory 60-second coalesce window.
 */
export function shouldRecordView(characterId: string, now: number = Date.now()): boolean {
  if (!characterId) return false;
  const lastTime = lastViewMap.get(characterId);
  if (lastTime !== undefined && now - lastTime < DEBOUNCE_WINDOW_MS) {
    return false;
  }
  lastViewMap.set(characterId, now);
  return true;
}

/**
 * Triggers an asynchronous, non-blocking background request to record a character view.
 * If called within 60s of the previous record for the same character, drops the call locally.
 * Failures are completely silent to ensure history recording never blocks UI interactions.
 */
export function recordView(characterId: string): void {
  if (!characterId || typeof window === "undefined") return;
  if (!shouldRecordView(characterId)) return;

  try {
    fetch("/api/history/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ characterId }),
      keepalive: true,
    }).catch(() => {
      // Intentionally ignored - history is best effort
    });
  } catch {
    // Intentionally ignored
  }
}

/**
 * Resets the in-memory debounce cache (useful for testing).
 */
export function resetClientTracker(): void {
  lastViewMap.clear();
}