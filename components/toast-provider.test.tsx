import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  addToastItem,
  completeExitToast,
  DEFAULT_DURATIONS,
  pauseToastItem,
  resumeToastItem,
  startExitToast,
  ToastCard,
  ToastItem,
  ToastProvider,
  ToastTimerScheduler,
  useToast,
} from "./toast-provider";
import { sanitizeToastError } from "./toast-utils";

function TestConsumer({
  onMount,
}: {
  onMount?: (methods: ReturnType<typeof useToast>) => void;
}) {
  const methods = useToast();
  onMount?.(methods);
  return <div data-testid="consumer">Consumer Active</div>;
}

describe("ToastProvider SSR & Baseline", () => {
  it("renders children cleanly within ToastProvider during SSR", () => {
    const html = renderToStaticMarkup(
      <ToastProvider>
        <TestConsumer />
      </ToastProvider>
    );

    expect(html).toContain("Consumer Active");
  });

  it("provides safe no-op methods when used outside ToastProvider without throwing", () => {
    let captured: ReturnType<typeof useToast> | null = null;
    const html = renderToStaticMarkup(
      <TestConsumer onMount={(m) => (captured = m)} />
    );

    expect(html).toContain("Consumer Active");
    expect(captured).not.toBeNull();
    expect(() => captured!.toast.success("Test")).not.toThrow();
    expect(() => captured!.toast.error("Test")).not.toThrow();
    expect(() => captured!.toast.warning("Test")).not.toThrow();
    expect(() => captured!.toast.info("Test")).not.toThrow();
    expect(() => captured!.toast.dismiss("123")).not.toThrow();
    expect(() => captured!.toast.clear()).not.toThrow();
  });
});

describe("ToastCard V1.1 Rendering & Progress Bar", () => {
  it("renders progress bar starting full at configured duration when active", () => {
    const item: ToastItem = {
      id: "toast-success-1",
      type: "success",
      message: "Character moved to Deleted",
      duration: 3500,
      announcement: "polite",
      createdAt: 1000,
      remainingMs: 3500,
      pausedAt: null,
      pulseCount: 0,
      isExiting: false,
    };

    const html = renderToStaticMarkup(
      <ToastCard
        item={item}
        onDismiss={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />
    );

    expect(html).toContain("Character moved to Deleted");
    expect(html).toContain("archive-toast-success");
    expect(html).toContain('data-duration="3500"');
    expect(html).toContain('data-remaining-ms="3500"');
    expect(html).toContain('data-paused="false"');
    expect(html).toContain('data-exiting="false"');
    expect(html).toContain("archive-toast-progress-track");
    expect(html).toContain("archive-toast-progress-fill");
    expect(html).toContain("animation-duration:3500ms");
    expect(html).toContain("animation-play-state:running");
  });

  it("freezes progress bar and sets animation-play-state: paused when paused", () => {
    const item: ToastItem = {
      id: "toast-paused-1",
      type: "warning",
      message: "Warning message",
      duration: 5500,
      announcement: "polite",
      createdAt: 1000,
      remainingMs: 2500,
      pausedAt: 4000,
      pulseCount: 0,
      isExiting: false,
    };

    const html = renderToStaticMarkup(
      <ToastCard
        item={item}
        onDismiss={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />
    );

    expect(html).toContain('data-paused="true"');
    expect(html).toContain('data-remaining-ms="2500"');
    expect(html).toContain("animation-play-state:paused");
  });

  it("omits progress track completely for persistent toasts (duration: 0)", () => {
    const item: ToastItem = {
      id: "toast-persistent-1",
      type: "info",
      message: "Persistent info notice",
      duration: 0,
      announcement: "polite",
      createdAt: 1000,
      remainingMs: 0,
      pausedAt: null,
      pulseCount: 0,
      isExiting: false,
    };

    const html = renderToStaticMarkup(
      <ToastCard
        item={item}
        onDismiss={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />
    );

    expect(html).toContain("Persistent info notice");
    expect(html).not.toContain("archive-toast-progress-track");
  });

  it("renders archive-toast-exiting and disables buttons during exit animation", () => {
    const item: ToastItem = {
      id: "toast-exiting-1",
      type: "error",
      message: "Connection failed",
      duration: 7000,
      announcement: "assertive",
      createdAt: 1000,
      remainingMs: 0,
      pausedAt: null,
      pulseCount: 0,
      isExiting: true,
    };

    const html = renderToStaticMarkup(
      <ToastCard
        item={item}
        onDismiss={() => {}}
        onPause={() => {}}
        onResume={() => {}}
      />
    );

    expect(html).toContain("archive-toast-exiting");
    expect(html).toContain('data-exiting="true"');
    expect(html).toContain("disabled");
    expect(html).not.toContain("archive-toast-progress-track");
  });
});

describe("Toast Timing & Lifecycle with Fake Timers", () => {
  it("auto-dismisses at exact deadline and unmounts after exit animation (180ms)", () => {
    vi.useFakeTimers();

    const scheduler = new ToastTimerScheduler();
    let toasts: ToastItem[] = [];
    const exitStarted: string[] = [];
    const exitCompleted: string[] = [];

    const { nextToasts } = addToastItem(
      toasts,
      {
        id: "toast-1",
        type: "success",
        message: "Item saved",
        duration: 3500,
        announcement: "polite",
      },
      1000
    );
    toasts = nextToasts;

    scheduler.scheduleAutoDismiss(toasts, (id) => {
      exitStarted.push(id);
      toasts = startExitToast(toasts, id, 1000 + 3500);
      scheduler.scheduleExit(id, (comp) => {
        exitCompleted.push(comp);
        toasts = completeExitToast(toasts, comp);
      });
    });

    // 1. Advance 3499ms: toast is still active, has not exited
    vi.advanceTimersByTime(3499);
    expect(exitStarted).toHaveLength(0);
    expect(toasts[0].isExiting).toBe(false);

    // 2. Advance 1ms (total 3500ms): auto-dismiss timeout fires!
    vi.advanceTimersByTime(1);
    expect(exitStarted).toEqual(["toast-1"]);
    expect(toasts[0].isExiting).toBe(true);
    expect(toasts).toHaveLength(1); // Still mounted during 180ms exit

    // 3. Advance 179ms: still in exit animation
    vi.advanceTimersByTime(179);
    expect(exitCompleted).toHaveLength(0);
    expect(toasts).toHaveLength(1);

    // 4. Advance 1ms (total 180ms exit): unmounts cleanly from state
    vi.advanceTimersByTime(1);
    expect(exitCompleted).toEqual(["toast-1"]);
    expect(toasts).toHaveLength(0);

    scheduler.clearAll();
    vi.useRealTimers();
  });

  it("hover pauses countdown, freezes progress, and resume continues from remaining time", () => {
    vi.useFakeTimers();

    const scheduler = new ToastTimerScheduler();
    let toasts: ToastItem[] = [];
    const exitStarted: string[] = [];

    const { nextToasts } = addToastItem(
      toasts,
      {
        id: "toast-hover",
        type: "success",
        message: "Hover test",
        duration: 3500,
        announcement: "polite",
      },
      0
    );
    toasts = nextToasts;

    const setupScheduler = () => {
      scheduler.scheduleAutoDismiss(toasts, (id) => {
        exitStarted.push(id);
        toasts = startExitToast(toasts, id, Date.now());
      });
    };

    setupScheduler();

    // 1. Advance 1500ms: 2000ms remaining
    vi.advanceTimersByTime(1500);
    expect(exitStarted).toHaveLength(0);

    // 2. Hover occurs at 1500ms
    toasts = pauseToastItem(toasts, "toast-hover", 1500);
    setupScheduler(); // pauses timer

    expect(toasts[0].pausedAt).toBe(1500);
    expect(toasts[0].remainingMs).toBe(2000);

    // 3. Stay hovered for 5000ms: timer must NOT fire!
    vi.advanceTimersByTime(5000);
    expect(exitStarted).toHaveLength(0);
    expect(toasts[0].remainingMs).toBe(2000);

    // 4. Leave hover at 6500ms: resume with 2000ms remaining
    toasts = resumeToastItem(toasts, "toast-hover", 6500);
    setupScheduler();

    expect(toasts[0].pausedAt).toBeNull();
    expect(toasts[0].remainingMs).toBe(2000);

    // 5. Advance 1999ms: still active
    vi.advanceTimersByTime(1999);
    expect(exitStarted).toHaveLength(0);

    // 6. Advance 1ms: exactly reaches 2000ms remaining -> fires exit!
    vi.advanceTimersByTime(1);
    expect(exitStarted).toEqual(["toast-hover"]);

    scheduler.clearAll();
    vi.useRealTimers();
  });

  it("keyboard focus pause matches hover pause behavior", () => {
    vi.useFakeTimers();

    let toasts: ToastItem[] = [];
    const { nextToasts } = addToastItem(
      toasts,
      {
        id: "toast-focus",
        type: "info",
        message: "Focus pause test",
        duration: 4000,
        announcement: "polite",
      },
      0
    );
    toasts = nextToasts;

    // Focus at 1000ms
    toasts = pauseToastItem(toasts, "toast-focus", 1000);
    expect(toasts[0].pausedAt).toBe(1000);
    expect(toasts[0].remainingMs).toBe(3000);

    // Blur at 3000ms
    toasts = resumeToastItem(toasts, "toast-focus", 3000);
    expect(toasts[0].pausedAt).toBeNull();
    expect(toasts[0].remainingMs).toBe(3000);

    vi.useRealTimers();
  });

  it("deduplication resets duration, resets remaining time to 100%, and increments pulse", () => {
    let toasts: ToastItem[] = [];

    // First toast
    const res1 = addToastItem(
      toasts,
      {
        id: "toast-dedupe",
        type: "success",
        message: "Added to Cart",
        duration: 3500,
        announcement: "polite",
      },
      1000
    );
    toasts = res1.nextToasts;
    expect(toasts[0].pulseCount).toBe(0);
    expect(toasts[0].remainingMs).toBe(3500);

    // Time elapses: 1500ms elapsed -> 2000ms remaining
    toasts = pauseToastItem(toasts, "toast-dedupe", 2500);
    expect(toasts[0].remainingMs).toBe(2000);

    // User triggers same action again: deduplicate!
    const res2 = addToastItem(
      toasts,
      {
        id: "toast-dedupe",
        type: "success",
        message: "Added to Cart",
        duration: 3500,
        announcement: "polite",
      },
      2600
    );
    toasts = res2.nextToasts;

    // Must reset to 100% (3500ms), unpause, and increment pulseCount
    expect(toasts).toHaveLength(1);
    expect(toasts[0].pulseCount).toBe(1);
    expect(toasts[0].remainingMs).toBe(3500);
    expect(toasts[0].pausedAt).toBeNull();
  });

  it("deduplicates 3 rapid identical Favorite toasts into exactly 1 active toast", () => {
    let toasts: ToastItem[] = [];

    // Trigger Removed from Favorites 3 times rapidly
    for (let i = 1; i <= 3; i++) {
      const res = addToastItem(
        toasts,
        {
          id: `fav-call-${i}`,
          type: "success",
          message: "Removed from Favorites",
          duration: 3500,
          announcement: "polite",
          coalesceKey: "favorites",
        },
        1000 + i * 100
      );
      toasts = res.nextToasts;
    }

    // Must report exactly 1 active matching toast with pulseCount 2
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Removed from Favorites");
    expect(toasts[0].pulseCount).toBe(2);
    expect(toasts[0].remainingMs).toBe(3500);
  });

  it("state inversion: Added to Favorites immediately followed by Removed from Favorites replaces contradictory toast", () => {
    let toasts: ToastItem[] = [];

    // 1. Added to Favorites
    const res1 = addToastItem(
      toasts,
      {
        id: "fav-add",
        type: "success",
        message: "Added to Favorites",
        duration: 3500,
        announcement: "polite",
        coalesceKey: "favorites",
      },
      1000
    );
    toasts = res1.nextToasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Added to Favorites");

    // 2. Immediately followed by Removed from Favorites
    const res2 = addToastItem(
      toasts,
      {
        id: "fav-remove",
        type: "success",
        message: "Removed from Favorites",
        duration: 3500,
        announcement: "polite",
        coalesceKey: "favorites",
      },
      1200
    );
    toasts = res2.nextToasts;

    // Must replace previous state: exactly 1 toast, now "Removed from Favorites"
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe("Removed from Favorites");
  });

  it("manual dismiss cancels timer immediately and executes 180ms exit lifecycle", () => {
    vi.useFakeTimers();

    const scheduler = new ToastTimerScheduler();
    let toasts: ToastItem[] = [];
    const exitCompleted: string[] = [];

    const { nextToasts } = addToastItem(
      toasts,
      {
        id: "toast-dismiss",
        type: "error",
        message: "Error message",
        duration: 7000,
        announcement: "assertive",
      },
      0
    );
    toasts = nextToasts;

    scheduler.scheduleAutoDismiss(toasts, () => {});

    // User clicks '×' manual dismiss at 1000ms
    toasts = startExitToast(toasts, "toast-dismiss", 1000);
    scheduler.scheduleExit("toast-dismiss", (comp) => {
      exitCompleted.push(comp);
      toasts = completeExitToast(toasts, comp);
    });

    expect(toasts[0].isExiting).toBe(true);

    // Advance 180ms: toast unmounts
    vi.advanceTimersByTime(180);
    expect(exitCompleted).toEqual(["toast-dismiss"]);
    expect(toasts).toHaveLength(0);

    scheduler.clearAll();
    vi.useRealTimers();
  });

  it("custom durations synchronize accurately (3500ms vs 7000ms)", () => {
    expect(DEFAULT_DURATIONS.success).toBe(3500);
    expect(DEFAULT_DURATIONS.info).toBe(4000);
    expect(DEFAULT_DURATIONS.warning).toBe(5500);
    expect(DEFAULT_DURATIONS.error).toBe(7000);

    const { nextToasts } = addToastItem(
      [],
      {
        id: "toast-custom",
        type: "info",
        message: "Custom time",
        duration: 10000,
        announcement: "polite",
      },
      0
    );

    expect(nextToasts[0].duration).toBe(10000);
    expect(nextToasts[0].remainingMs).toBe(10000);
  });

  it("maximum-stack eviction triggers exit lifecycle on oldest active toast", () => {
    vi.useFakeTimers();

    let toasts: ToastItem[] = [];

    // Add 3 toasts (max visible)
    toasts = addToastItem(toasts, { id: "t1", type: "info", message: "1", duration: 4000, announcement: "polite" }, 0).nextToasts;
    toasts = addToastItem(toasts, { id: "t2", type: "info", message: "2", duration: 4000, announcement: "polite" }, 0).nextToasts;
    toasts = addToastItem(toasts, { id: "t3", type: "info", message: "3", duration: 4000, announcement: "polite" }, 0).nextToasts;

    expect(toasts.filter((t) => !t.isExiting)).toHaveLength(3);

    // Add 4th toast -> evicts t1
    const { nextToasts, evictedId } = addToastItem(
      toasts,
      { id: "t4", type: "info", message: "4", duration: 4000, announcement: "polite" },
      0
    );
    toasts = nextToasts;

    expect(evictedId).toBe("t1");
    expect(toasts.find((t) => t.id === "t1")?.isExiting).toBe(true);
    expect(toasts.filter((t) => !t.isExiting)).toHaveLength(3); // t2, t3, t4

    // Complete exit for t1 after 180ms
    toasts = completeExitToast(toasts, "t1");
    expect(toasts.map((t) => t.id)).toEqual(["t2", "t3", "t4"]);

    vi.useRealTimers();
  });
});

describe("Reduced Motion Support", () => {
  it("defines reduced motion CSS overrides that hide the progress track and use opacity transitions", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path");
    const css = fs.readFileSync(path.resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".archive-toast-progress-track");
    expect(css).toContain("display: none !important;");
    expect(css).toContain("archive-toast-fade-in");
    expect(css).toContain("archive-toast-fade-out");
  });
});

describe("sanitizeToastError", () => {
  it("sanitizes Prisma errors and connection leaks into safe user messages", () => {
    const prismaError = new Error("Invalid `prisma.character.findUnique()` invocation: relation does not exist");
    expect(sanitizeToastError(prismaError)).toBe("The operation could not be completed. Please try again.");

    const connError = "Error: connect ECONNREFUSED 127.0.0.1:5432";
    expect(sanitizeToastError(connError)).toBe("The operation could not be completed. Please try again.");

    const sqlError = new Error("SELECT * FROM Character WHERE id = 'xyz' violates foreign key constraint");
    expect(sanitizeToastError(sqlError)).toBe("The operation could not be completed. Please try again.");
  });

  it("preserves safe, human-readable user messages while stripping Error prefix", () => {
    expect(sanitizeToastError("Error: Character not found.")).toBe("Character not found.");
    expect(sanitizeToastError("Failed to update collection.")).toBe("Failed to update collection.");
    expect(sanitizeToastError("Name is required.")).toBe("Name is required.");
  });

  it("falls back to provided custom fallback when error is empty or null", () => {
    expect(sanitizeToastError(null, "Custom fallback.")).toBe("Custom fallback.");
    expect(sanitizeToastError("", "Custom fallback.")).toBe("Custom fallback.");
  });
});
