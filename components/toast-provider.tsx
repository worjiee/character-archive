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
  /** Custom duration in milliseconds. */
  duration?: number;
  /** Announcement level for screen readers: 'polite' or 'assertive'. */
  announcement?: "polite" | "assertive";
  /** Optional action slot for future Undo (v1.1) or quick link. */
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

const DEFAULT_DURATIONS: Record<ToastType, number> = {
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

const MAX_VISIBLE_TOASTS = 3;

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdCounter = useRef(1);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clear = useCallback(() => {
    setToasts([]);
  }, []);

  const addToast = useCallback(
    (type: ToastType, message: string, options?: ToastOptions): string => {
      const duration = options?.duration ?? DEFAULT_DURATIONS[type];
      const announcement = options?.announcement ?? DEFAULT_ANNOUNCEMENTS[type];
      const coalesceKey = options?.coalesceKey;
      const explicitId = options?.id;
      const id = explicitId || coalesceKey || `toast-${Date.now()}-${nextIdCounter.current++}`;

      setToasts((prev) => {
        // 1. Deduplication: Check if identical message & type or same id/coalesceKey already exists
        const existingIndex = prev.findIndex(
          (t) =>
            (explicitId && t.id === explicitId) ||
            (coalesceKey && t.coalesceKey === coalesceKey) ||
            (!explicitId && !coalesceKey && t.message === message && t.type === type)
        );

        if (existingIndex !== -1) {
          const existing = prev[existingIndex];
          // If identical message: reset timer and bump pulse animation
          if (existing.message === message && existing.type === type) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...existing,
              remainingMs: duration,
              pausedAt: null,
              pulseCount: existing.pulseCount + 1,
            };
            return updated;
          }

          // Opposite or updated state with same coalesceKey: replace the old toast
          const filtered = prev.filter((_, idx) => idx !== existingIndex);
          const newItem: ToastItem = {
            id,
            type,
            message,
            duration,
            announcement,
            action: options?.action,
            coalesceKey,
            createdAt: Date.now(),
            remainingMs: duration,
            pausedAt: null,
            pulseCount: 0,
          };
          return [...filtered, newItem].slice(-MAX_VISIBLE_TOASTS);
        }

        // New toast
        const newItem: ToastItem = {
          id,
          type,
          message,
          duration,
          announcement,
          action: options?.action,
          coalesceKey,
          createdAt: Date.now(),
          remainingMs: duration,
          pausedAt: null,
          pulseCount: 0,
        };

        const updated = [...prev, newItem];
        // Enforce maximum visible stack of 3 (evicts oldest)
        if (updated.length > MAX_VISIBLE_TOASTS) {
          return updated.slice(updated.length - MAX_VISIBLE_TOASTS);
        }
        return updated;
      });

      return id;
    },
    []
  );

  const pauseToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.pausedAt !== null) return t;
        const now = Date.now();
        const elapsed = now - t.createdAt;
        const remaining = Math.max(0, t.duration - elapsed);
        return { ...t, pausedAt: now, remainingMs: remaining };
      })
    );
  }, []);

  const resumeToast = useCallback((id: string) => {
    setToasts((prev) =>
      prev.map((t) => {
        if (t.id !== id || t.pausedAt === null) return t;
        return {
          ...t,
          pausedAt: null,
          createdAt: Date.now() - (t.duration - t.remainingMs),
        };
      })
    );
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

function ToastViewport({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
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

  // Global countdown timer for unpaused toasts
  useEffect(() => {
    if (toasts.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      toasts.forEach((t) => {
        if (t.pausedAt !== null) return;
        const elapsed = now - t.createdAt;
        if (elapsed >= t.duration) {
          onDismiss(t.id);
        }
      });
    }, 100);

    return () => clearInterval(interval);
  }, [toasts, onDismiss]);

  if (!mounted) return null;

  // Filter latest polite / assertive announcements for screen readers
  const latestPolite = [...toasts].reverse().find((t) => t.announcement === "polite");
  const latestAssertive = [...toasts].reverse().find((t) => t.announcement === "assertive");

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

function ToastCard({
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
  const { type, message, action, pulseCount } = item;

  return (
    <div
      tabIndex={-1}
      key={pulseCount}
      onPointerEnter={onPause}
      onPointerLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
      className={`archive-toast-card archive-toast-${type} ${
        pulseCount > 0 ? "archive-toast-pulse" : ""
      }`}
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

      {/* Optional Action Button (reserved for future undo / quick action) */}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="archive-toast-action archive-focus"
        >
          {action.label}
        </button>
      )}

      {/* Manual Dismiss Button */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="archive-toast-dismiss archive-focus"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ×
        </span>
      </button>
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
