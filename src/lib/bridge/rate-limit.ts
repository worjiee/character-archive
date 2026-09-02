export class BridgeExchangeRateLimiter {
  private readonly attempts = new Map<string, { count: number; startedAt: number }>();

  constructor(private readonly limit = 5, private readonly windowMs = 5 * 60 * 1000) {}

  consume(key: string, now = Date.now()): { limited: boolean; retryAfterSeconds: number } {
    this.prune(now);
    const current = this.attempts.get(key);
    if (!current) {
      this.attempts.set(key, { count: 1, startedAt: now });
      return { limited: false, retryAfterSeconds: 0 };
    }
    current.count += 1;
    if (current.count <= this.limit) return { limited: false, retryAfterSeconds: 0 };
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + this.windowMs - now) / 1000)),
    };
  }

  clear(key: string): void { this.attempts.delete(key); }

  private prune(now: number): void {
    for (const [key, value] of this.attempts) {
      if (value.startedAt + this.windowMs <= now) this.attempts.delete(key);
    }
  }
}

const rateLimitGlobal = globalThis as typeof globalThis & { bridgeExchangeRateLimiter?: BridgeExchangeRateLimiter };
export const bridgeExchangeRateLimiter = rateLimitGlobal.bridgeExchangeRateLimiter ?? new BridgeExchangeRateLimiter();
if (process.env.NODE_ENV !== "production") rateLimitGlobal.bridgeExchangeRateLimiter = bridgeExchangeRateLimiter;

export function bridgeRateLimitKey(request: Request): string {
  return (request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown").slice(0, 128);
}
