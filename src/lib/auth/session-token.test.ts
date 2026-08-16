import { describe, expect, it } from "vitest";
import { signOwnerSessionToken, verifyOwnerSessionToken } from "./session-token";

const secret = "test-session-secret-that-is-longer-than-thirty-two-bytes";
const now = new Date("2026-08-17T00:00:00.000Z");
const payload = {
  sessionId: "0f2233ea-237e-4cd0-a50e-2bde51582731",
  subject: "owner" as const,
  issuedAt: Math.floor(now.getTime() / 1000),
  expiresAt: Math.floor(now.getTime() / 1000) + 3600,
};

describe("owner session tokens", () => {
  it("verifies an unexpired signed session", async () => {
    const token = await signOwnerSessionToken(payload, secret);
    await expect(verifyOwnerSessionToken(token, secret, now)).resolves.toEqual(payload);
  });

  it("rejects expired and tampered sessions", async () => {
    const token = await signOwnerSessionToken(payload, secret);
    await expect(verifyOwnerSessionToken(token, secret, new Date(now.getTime() + 3_600_000))).resolves.toBeNull();
    await expect(verifyOwnerSessionToken(`${token.slice(0, -1)}x`, secret, now)).resolves.toBeNull();
  });
});
