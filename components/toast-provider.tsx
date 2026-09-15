"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  /** Optional custom ID or deduplication key. */
  id?: string;
  /** Custom duration in milliseconds. 0 or Infinity disables auto-dismiss. */
  duration?: number;
  /** Announcement level for screen readers: 'polite' or 'assertive'. */
  announcement?: "polite" | "assertive";
  /** Optional action slot for future Undo or quick link. */
  action?: {
    label: string;
    onClick: () => void;
  };
  /**
   * Coalesce key to prevent contradictory state toasts.
   * e.g., 'fav-char123' will replace 'Added to Favorites' with 'Removed from Favorites'.
   */
  coalesceKey?: string;
}

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
  announcement: "polite" | "assertive";
  action?: {
    label: string;
    onClick: () => void;
  };
  coalesceKey?: string;
  createdAt: number;
  remainingMs: number;
  pausedAt: number | null;
  pulseCount: number;
  isExiting?: boolean;
}

export interface ToastContextValue {
  toast: {
    success: (message: string, options?: ToastOptions) => string;
    error: (message: string, options?: ToastOptions) => string;
    warning: (message: string, options?: ToastOptions) => string;
    info: (message: string, options?: ToastOptions) => string;
    dismiss: (id: string) => void;
    clear: () => void;
  };
}

export const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 3500,
  info: 4000,
  warning: 5500,
  error: 7000,
};

const DEFAULT_ANNOUNCEMENTS: Record<ToastType, "polite" | "assertive"> = {
  success: "polite",
  info: "polite",
  warning: "polite",
  error: "assertive",
};

export const MAX_VISIBLE_TOASTS = 3;
export const EXIT_ANIMATION_MS = 180;

export function addToastItem(
  prev: ToastItem[],
  newItemData: {
    id: string;
    type: ToastType;
    message: string;
    duration: number;
    announcement: "polite" | "assertive";
    action?: { label: string; onClick: () => void };
    coalesceKey?: string;
  },
  now: number
): { nextToasts: ToastItem[]; evictedId: string | null } {
  const { id, type, message, duration, announcement, action, coalesceKey } = newItemData;

  // 1. Deduplication check on active toasts
  const existingIndex = prev.findIndex(
    (t) =>
      !t.isExiting &&
      ((id && t.id === id) ||
        (coalesceKey && t.coalesceKey === coalesceKey) ||
        (!coalesceKey && t.message === message && t.type === type))
  );

  if (existingIndex !== -1) {
    const existing = prev[existingIndex];
    if (existing.message === message && existing.type === type) {
      const updated = [...prev];
      updated[existingIndex] = {
        ...existing,
        duration,
        remainingMs: duration,
        pausedAt: null,
        createdAt: now,
        pulseCount: existing.pulseCount + 1,
        isExiting: false,
      };
      return { nextToasts: updated, evictedId: null };
    }

    // Coalesce / state update: replace previous
    const filtered = prev.filter((_, idx) => idx !== existingIndex);
    const newItem: ToastItem = {
      id,
      type,
      message,
      duration,
      announcement,
      action,
      coalesceKey,
      createdAt: now,
      remainingMs: duration,
      pausedAt: null,
      pulseCount: 0,
      isExiting: false,
    };
    return { nextToasts: [...filtered, newItem], evictedId: null };
  }

  // New item
  const newItem: ToastItem = {
    id,
    type,
    message,
    duration,
    announcement,
    action,
    coalesceKey,
    createdAt: now,
    remainingMs: duration,
    pausedAt: null,
    pulseCount: 0,
    isExiting: false,
  };

  const activeToasts = prev.filter((t) => !t.isExiting);
  if (activeToasts.length >= MAX_VISIBLE_TOASTS) {
    const oldestActive = activeToasts[0];
    const updated = prev.map((t) =>
      t.id === oldestActive.id ? { ...t, isExiting: true, pausedAt: now } : t
    );
    return { nextToasts: [...updated, newItem], evictedId: oldestActive.id };
  }

  return { nextToasts: [...prev, newItem], evictedId: null };
}

export function pauseToastItem(prev: ToastItem[], id: string, now: number): ToastItem[] {
  return prev.map((t) => {
    if (t.id !== id || t.pausedAt !== null || t.isExiting) return t;
    const elapsed = now - t.createdAt;
    const remaining = Math.max(0, t.duration - elapsed);
    return { ...t, pausedAt: now, remainingMs: remaining };
  });
}

export function resumeToastItem(prev: ToastItem[], id: string, now: number): ToastItem[] {
  return prev.map((t) => {
    if (t.id !== id || t.pausedAt === null || t.isExiting) return t;
    return {
      ...t,
      pausedAt: null,
      createdAt: now - (t.duration - t.remainingMs),
    };
  });
}

export function startExitToast(prev: ToastItem[], id: string, now: number): ToastItem[] {
  return prev.map((t) =>
    t.id === id ? { ...t, isExiting: true, pausedAt: now, remainingMs: 0 } : t
  );
}

export function completeExitToast(prev: ToastItem[], id: string): ToastItem[] {
  return prev.filter((t) => t.id !== id);
}

export class ToastTimerScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private exitTimers = new Map<string, ReturnType<typeof setTimeout>>();

  scheduleAutoDismiss(toasts: ToastItem[], onStartExit: (id: string) => void) {
    this.clearAutoDismissTimers();

    toasts.forEach((t) => {
      if (t.isExiting) return;
      if (t.duration <= 0 || !Number.isFinite(t.duration)) return;
      if (t.pausedAt !== null) return;

      const remaining = t.remainingMs;
      if (remaining <= 0) {
        onStartExit(t.id);
        return;
      }

      const timer = setTimeout(() => {
        onStartExit(t.id);
      }, remaining);

      this.timers.set(t.id, timer);
    });
  }

  scheduleExit(id: string, onComplete: (id: string) => void, exitMs = EXIT_ANIMATION_MS) {
    if (this.timers.has(id)) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
    }
    const timer = setTimeout(() => {
      onComplete(id);
      this.exitTimers.delete(id);
    }, exitMs);
    this.exitTimers.set(id, timer);
  }

  clearAutoDismissTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
  }

  clearAll() {
    this.clearAutoDismissTimers();
    this.exitTimers.forEach((t) => clearTimeout(t));
    this.exitTimers.clear();
  }
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdCounter = useRef(1);

  const startExit = useCallback((id: string) => {
    setToasts((prev) => startExitToast(prev, id, Date.now()));
    setTimeout(() => {
      setToasts((prev) => completeExitToast(prev, id));
    }, EXIT_ANIMATION_MS);
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      startExit(id);
    },
    [startExit]
  );

  const clear = useCallback(() => {
    setToasts((prev) =>
      prev.map((t) => ({ ...t, isExiting: true, pausedAt: Date.now() }))
    );
    setTimeout(() => {
      setToasts([]);
    }, EXIT_ANIMATION_MS);
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const duration = options?.duration ?? DEFAULT_DURATIONS[type];
      const announcement = options?.announcement ?? DEFAULT_ANNOUNCEMENTS[type];
      const coalesceKey = options?.coalesceKey;
      const explicitId = options?.id;
      const id = explicitId || coalesceKey || `toast-${Date.now()}-${nextIdCounter.current++}`;

      setToasts((prev) => {
        const { nextToasts, evictedId } = addToastItem(
          prev,
          { id, type, message, duration, announcement, action: options?.action, coalesceKey },
          Date.now()
        );
        if (evictedId) {
          setTimeout(() => {
            setToasts((current) => completeExitToast(current, evictedId));
          }, EXIT_ANIMATION_MS);
        }
        return nextToasts;
      });

      return id;
    },
    []
  );

  const pauseToast = useCallback((id: string) => {
    setToasts((prev) => pauseToastItem(prev, id, Date.now()));
  }, []);

  const resumeToast = useCallback((id: string) => {
    setToasts((prev) => resumeToastItem(prev, id, Date.now()));
  }, []);

  useEffect(() => {
    function handleCustomEvent(event: Event) {
      const detail = (event as CustomEvent<{ type?: ToastType; message: string; options?: ToastOptions }>).detail;
      if (detail && detail.message) {
        addToast(detail.type || "info", detail.message, detail.options);
      }
    }
    window.addEventListener("archive:toast", handleCustomEvent);
    return () => window.removeEventListener("archive:toast", handleCustomEvent);
  }, [addToast]);

  const toastMethods = useMemo(
    () => ({
      success: (msg: string, opts?: ToastOptions) => addToast("success", msg, opts),
      error: (msg: string, opts?: ToastOptions) => addToast("error", msg, opts),
      warning: (msg: string, opts?: ToastOptions) => addToast("warning", msg, opts),
      info: (msg: string, opts?: ToastOptions) => addToast("info", msg, opts),
      dismiss,
      clear,
    }),
    [addToast, dismiss, clear]
  );

  return (
    <ToastContext.Provider value={{ toast: toastMethods }}>
      {children}
      <ToastViewport
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pauseToast}
        onResume={resumeToast}
        onStartExit={startExit}
      />
    </ToastContext.Provider>
  );
}

const NOOP_TOAST: ToastContextValue = {
  toast: {
    success: () => "",
    error: () => "",
    warning: () => "",
    info: () => "",
    dismiss: () => {},
    clear: () => {},
  },
};

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  return context ?? NOOP_TOAST;
}

/**
 * Toast Viewport Container:
 * Renders into the browser Top Layer using popover="manual" where supported.
 * Falls back to portaling into the topmost open <dialog> or document.body.
 */
const emptySubscribe = () => () => {};
function useIsMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  onPause,
  onResume,
  onStartExit,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onStartExit: (id: string) => void;
}) {
  const mounted = useIsMounted();
  const [activeDialog, setActiveDialog] = useState<HTMLDialogElement | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const politeLiveId = useId();
  const assertiveLiveId = useId();

  // Watcher for open modal dialogs
  useEffect(() => {
    if (!mounted) return;

    function checkOpenDialog() {
      const dialog = document.querySelector<HTMLDialogElement>(
        'dialog[open]:not([aria-hidden="true"])'
      );
      setActiveDialog(dialog);
    }

    checkOpenDialog();
    const observer = new MutationObserver(checkOpenDialog);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["open"],
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [mounted]);

  // Ensure Popover is on top of Top Layer whenever toasts appear or a dialog opens
  useEffect(() => {
    if (!mounted) return;
    const el = viewportRef.current;
    if (el && typeof el.showPopover === "function") {
      try {
        el.hidePopover();
      } catch {}
      try {
        el.showPopover();
      } catch {}
    }
  }, [mounted, toasts.length, activeDialog]);

  // Synchronized dismissal timers for unpaused, non-exiting auto-dismiss toasts
  useEffect(() => {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();

    toasts.forEach((t) => {
      if (t.isExiting) return;
      if (t.duration <= 0 || !Number.isFinite(t.duration)) return;
      if (t.pausedAt !== null) return;

      const remaining = t.remainingMs;
      if (remaining <= 0) {
        onStartExit(t.id);
        return;
      }

      const timer = setTimeout(() => {
        onStartExit(t.id);
      }, remaining);

      timers.set(t.id, timer);
    });

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
    };
  }, [toasts, onStartExit]);

  if (!mounted) return null;

  // Filter latest polite / assertive announcements for screen readers
  const latestPolite = [...toasts].reverse().find((t) => !t.isExiting && t.announcement === "polite");
  const latestAssertive = [...toasts].reverse().find((t) => !t.isExiting && t.announcement === "assertive");

  const content = (
    <div
      ref={viewportRef}
      popover="manual"
      className="archive-toast-viewport"
      aria-label="Action feedback"
    >
      {/* Screen reader live announcement regions */}
      <div
        id={politeLiveId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {latestPolite?.message}
      </div>
      <div
        id={assertiveLiveId}
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        {latestAssertive?.message}
      </div>

      {/* Visible toast cards stack */}
      <div className="archive-toast-stack" role="region" aria-label="Notifications">
        {toasts.map((item) => (
          <ToastCard
            key={item.id}
            item={item}
            onDismiss={() => onDismiss(item.id)}
            onPause={() => onPause(item.id)}
            onResume={() => onResume(item.id)}
          />
        ))}
      </div>
    </div>
  );

  const targetNode = activeDialog ? activeDialog : document.body;

  return createPortal(content, targetNode);
}

export function ToastCard({
  item,
  onDismiss,
  onPause,
  onResume,
}: {
  item: ToastItem;
  onDismiss: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  const { type, message, action, pulseCount, isExiting, duration, pausedAt, remainingMs } = item;
  const isPaused = pausedAt !== null;
  const showProgress = duration > 0 && Number.isFinite(duration) && !isExiting;

  return (
    <div
      tabIndex={-1}
      key={pulseCount}
      data-toast-id={item.id}
      data-type={type}
      data-duration={duration}
      data-remaining-ms={Math.round(remainingMs)}
      data-paused={isPaused}
      data-exiting={Boolean(isExiting)}
      data-pulse={pulseCount}
      onPointerEnter={onPause}
      onPointerLeave={onResume}
      onFocus={onPause}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          onResume();
        }
      }}
      className={`archive-toast-card archive-toast-${type} ${
        pulseCount > 0 ? "archive-toast-pulse" : ""
      } ${isExiting ? "archive-toast-exiting" : ""}`}
    >
      {/* Icon */}
      <span className="archive-toast-icon" aria-hidden="true">
        {type === "success" && <SuccessIcon />}
        {type === "error" && <ErrorIcon />}
        {type === "warning" && <WarningIcon />}
        {type === "info" && <InfoIcon />}
      </span>

      {/* Text Message */}
      <div className="archive-toast-message">
        <p className="line-clamp-2">{message}</p>
      </div>

      {/* Optional Action Button */}
      {action && (
        <button
          type="button"
          disabled={isExiting}
          onClick={action.onClick}
          className="archive-toast-action archive-focus"
        >
          {action.label}
        </button>
      )}

      {/* Manual Dismiss Button */}
      <button
        type="button"
        disabled={isExiting}
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="archive-toast-dismiss archive-focus"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ×
        </span>
      </button>

      {/* Synchronized Lifetime Progress Bar */}
      {showProgress && (
        <div
          className="archive-toast-progress-track"
          aria-hidden="true"
          data-testid="toast-progress-track"
        >
          <div
            key={`fill-${item.id}-${pulseCount}`}
            className="archive-toast-progress-fill"
            style={{
              animationDuration: `${duration}ms`,
              animationPlayState: isPaused ? "paused" : "running",
            }}
          />
        </div>
      )}
    </div>
  );
}

/* SVG Icons with semantic color styling */
function SuccessIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-emerald-400 shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-red-400 shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-amber-400 shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-4 w-4 text-sky-400 shrink-0"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
        clipRule="evenodd"
      />
    </svg>
  );
}
