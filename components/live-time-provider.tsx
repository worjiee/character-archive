"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createLiveTimeStore, type LiveTimeStore } from "../src/lib/home/live-time";

const LiveTimeContext = createContext<LiveTimeStore | null>(null);

export function LiveTimeProvider({
  initialNow,
  intervalMs = 5_000,
  children,
}: {
  initialNow: string;
  intervalMs?: number;
  children: React.ReactNode;
}) {
  const store = useMemo(
    () => createLiveTimeStore(initialNow, intervalMs),
    [initialNow, intervalMs],
  );

  return (
    <LiveTimeContext.Provider value={store}>
      {children}
    </LiveTimeContext.Provider>
  );
}

/**
 * Returns a live-advancing ISO timestamp anchored to a server-provided
 * reference time. Subscribes to the nearest LiveTimeProvider context store,
 * or creates a standalone store from `fallbackNow`.
 *
 * Uses useState + useEffect instead of useSyncExternalStore to guarantee
 * that timer ticks trigger React re-renders after Next.js streaming
 * hydration, which can silently prevent useSyncExternalStore from
 * re-subscribing to the external store post-hydration in React 19.
 */
export function useLiveNow(fallbackNow?: string): string {
  const contextStore = useContext(LiveTimeContext);

  const fallbackStore = useMemo(() => {
    if (contextStore || !fallbackNow) return null;
    return createLiveTimeStore(fallbackNow);
  }, [contextStore, fallbackNow]);

  const activeStore = contextStore ?? fallbackStore;

  // Start with the server snapshot to match SSR output and avoid
  // hydration mismatch. The useEffect below activates only on the
  // client and advances the value on every store tick.
  const [now, setNow] = useState(() =>
    activeStore ? activeStore.getServerSnapshot() : (fallbackNow ?? ""),
  );

  useEffect(() => {
    if (!activeStore) return;
    // Subscribe to store ticks. The store's subscribe method adds
    // a listener and starts the shared interval on first subscriber.
    // Each tick calls setNow with the latest advancing snapshot.
    const unsubscribe = activeStore.subscribe(() => {
      setNow(activeStore.getSnapshot());
    });
    return unsubscribe;
  }, [activeStore]);

  return now;
}
