import { describe, expect, it } from "vitest";
import {
  createUserSessionToken,
  hashUserSessionToken,
  isPotentialUserSessionToken,
  USER_SESSION_TOKEN_BYTES,
} from "./session-token";

describe("opaque user session tokens", () => {
  it("creates exactly 32 random bytes encoded for cookies", () => {
    const first = createUserSessionToken();
    const second = createUserSessionToken();
    expect(Buffer.from(first, "base64url")).toHaveLength(USER_SESSION_TOKEN_BYTES);
    expect(first).not.toBe(second);
    expect(isPotentialUserSessionToken(first)).toBe(true);
  });

  it("stores only a deterministic SHA-256 hash", () => {
    const token = "A".repeat(43);
    expect(hashUserSessionToken(token)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashUserSessionToken(token)).not.toContain(token);
  });

  it("rejects signed legacy and malformed cookie shapes", () => {
    expect(isPotentialUserSessionToken("payload.signature")).toBe(false);
    expect(isPotentialUserSessionToken("short")).toBe(false);
    expect(isPotentialUserSessionToken(undefined)).toBe(false);
  });
});
