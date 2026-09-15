/**
 * Toast utility functions for message formatting, sanitization, and timing.
 */

const LEAKY_PATTERNS = [
  /prisma/i,
  /supabase/i,
  /postgres/i,
  /\bselect\s+[\w\s,*()_"]+\s+from\b/i,
  /\binsert\s+into\b/i,
  /\bupdate\s+["']?[\w_]+["']?\s+set\b/i,
  /\bdelete\s+from\b/i,
  /relation\s+["']?[\w_]+["']?\s+does\s+not\s+exist/i,
  /foreign\s+key/i,
  /constraint/i,
  /violates\s+unique/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // UUID
  /at\s+[\w_.]+\s+\(.*:\d+:\d+\)/, // Stack trace
  /node_modules/i,
  /connection\s+refused/i,
  /econnrefused/i,
  /\bpassword\b/i,
  /\bsecret\b/i,
];

/**
 * Sanitizes an error message for safe display in user toasts.
 * Strips internal SQL, Prisma, credential, or stack trace details.
 */
export function sanitizeToastError(
  error: unknown,
  fallback = "The operation could not be completed. Please try again."
): string {
  if (!error) return fallback;

  let message = "";
  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "object" && error !== null && "message" in error) {
    message = String((error as { message?: unknown }).message ?? "");
  }

  message = message.trim();
  if (!message) return fallback;

  // Strip leading "Error: "
  if (message.startsWith("Error: ")) {
    message = message.slice(7).trim();
  }

  // Check against leaky patterns
  for (const pattern of LEAKY_PATTERNS) {
    if (pattern.test(message)) {
      return fallback;
    }
  }

  // Limit maximum length to 160 chars for toasts
  if (message.length > 160) {
    return `${message.slice(0, 157)}…`;
  }

  return message;
}
