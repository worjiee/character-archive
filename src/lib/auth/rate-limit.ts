const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

interface LoginAttempt {
  failures: number;
  windowStartedAt: number;
}

export class LoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttempt>();

  check(key: string, now = Date.now()): { limited: boolean; retryAfterSeconds: number } {
    this.prune(now);
    const attempt = this.attempts.get(key);
    if (!attempt || attempt.failures < LOGIN_ATTEMPT_LIMIT) {
      return { limited: false, retryAfterSeconds: 0 };
    }
    const retryAfterMs = attempt.windowStartedAt + LOGIN_ATTEMPT_WINDOW_MS - now;
    return { limited: retryAfterMs > 0, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  recordFailure(key: string, now = Date.now()): void {
    this.prune(now);
    const existing = this.attempts.get(key);
    if (existing) existing.failures += 1;
    else this.attempts.set(key, { failures: 1, windowStartedAt: now });
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }

  private prune(now: number): void {
    for (const [key, attempt] of this.attempts) {
      if (attempt.windowStartedAt + LOGIN_ATTEMPT_WINDOW_MS <= now) this.attempts.delete(key);
    }
  }
}

const globalForLoginRateLimit = globalThis as typeof globalThis & {
  characterArchiveLoginRateLimiter?: LoginRateLimiter;
};

export const loginRateLimiter = globalForLoginRateLimit.characterArchiveLoginRateLimiter ?? new LoginRateLimiter();
if (process.env.NODE_ENV !== "production") {
  globalForLoginRateLimit.characterArchiveLoginRateLimiter = loginRateLimiter;
}

export function loginRateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const direct = request.headers.get("x-real-ip")?.trim();
  const address = forwarded || direct || "unknown";
  return address.slice(0, 128);
}
