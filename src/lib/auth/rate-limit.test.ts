import { describe, expect, it } from "vitest";
import { LoginRateLimiter } from "./rate-limit";

describe("login rate limiting", () => {
  it("limits repeated failures and resets after the window", () => {
    const limiter = new LoginRateLimiter();
    const startedAt = Date.parse("2026-08-17T00:00:00.000Z");
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("client", startedAt);
    expect(limiter.check("client", startedAt)).toMatchObject({ limited: true });
    expect(limiter.check("client", startedAt + 15 * 60 * 1000)).toEqual({ limited: false, retryAfterSeconds: 0 });
  });

  it("clears failures after a successful login", () => {
    const limiter = new LoginRateLimiter();
    for (let attempt = 0; attempt < 5; attempt += 1) limiter.recordFailure("client", 0);
    limiter.clear("client");
    expect(limiter.check("client", 0)).toEqual({ limited: false, retryAfterSeconds: 0 });
  });
});
