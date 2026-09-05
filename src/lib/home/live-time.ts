export interface LiveTimeStore {
  subscribe: (callback: () => void) => () => void;
  getSnapshot: () => string;
  getServerSnapshot: () => string;
  getListenerCount?: () => number;
}

/**
 * Creates a reactive reference-time store anchored to a server-provided timestamp.
 * Advances smoothly based on client-elapsed time to avoid client clock-skew issues.
 * Only starts a single timer when at least one subscriber is active, and cleans up
 * the interval automatically when all subscribers unmount.
 */
export function createLiveTimeStore(
  initialNow: string,
  intervalMs: number = 5_000,
): LiveTimeStore {
  const listeners = new Set<() => void>();
  let intervalId: ReturnType<typeof setInterval> | null = null;
  const initialNowMs = Date.parse(initialNow);
  const startClientMs = Date.now();
  let currentSnapshot = initialNow;

  function tick() {
    const elapsedClientMs = Math.max(0, Date.now() - startClientMs);
    currentSnapshot = new Date(initialNowMs + elapsedClientMs).toISOString();
    for (const listener of listeners) {
      listener();
    }
  }

  function subscribe(callback: () => void): () => void {
    listeners.add(callback);
    if (listeners.size === 1) {
      intervalId = setInterval(tick, intervalMs);
    }
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0 && intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
  }

  return {
    subscribe,
    getSnapshot: () => currentSnapshot,
    getServerSnapshot: () => initialNow,
    getListenerCount: () => listeners.size,
  };
}
