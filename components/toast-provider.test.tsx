import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastProvider, useToast } from "./toast-provider";
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

describe("ToastProvider", () => {
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
