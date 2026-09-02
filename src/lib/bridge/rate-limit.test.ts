import { describe, expect, it } from "vitest";
import { BridgeExchangeRateLimiter } from "./rate-limit";

describe("bridge exchange rate limiting", () => {
  it("limits repeated exchange attempts and resets after the window", () => {
    const limiter = new BridgeExchangeRateLimiter(2, 1_000);
    expect(limiter.consume("client", 0).limited).toBe(false);
    expect(limiter.consume("client", 1).limited).toBe(false);
    expect(limiter.consume("client", 2)).toMatchObject({ limited: true, retryAfterSeconds: 1 });
    expect(limiter.consume("client", 1_001).limited).toBe(false);
  });

  it("isolates callers and can clear a successful caller", () => {
    const limiter = new BridgeExchangeRateLimiter(1, 1_000);
    limiter.consume("one", 0);
    expect(limiter.consume("one", 1).limited).toBe(true);
    expect(limiter.consume("two", 1).limited).toBe(false);
    limiter.clear("one");
    expect(limiter.consume("one", 2).limited).toBe(false);
  });
});
