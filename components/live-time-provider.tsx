"use client";

import React, { createContext, useContext, useMemo, useSyncExternalStore } from "react";
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

const noopSubscribe = () => () => {};

export function useLiveNow(fallbackNow?: string): string {
  const contextStore = useContext(LiveTimeContext);

  const fallbackStore = useMemo(() => {
    if (contextStore || !fallbackNow) return null;
    return createLiveTimeStore(fallbackNow);
  }, [contextStore, fallbackNow]);

  const activeStore = contextStore ?? fallbackStore;

  return useSyncExternalStore(
    activeStore ? activeStore.subscribe : noopSubscribe,
    activeStore ? activeStore.getSnapshot : () => fallbackNow ?? "",
    activeStore ? activeStore.getServerSnapshot : () => fallbackNow ?? "",
  );
}
