import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
}));
const bridge = vi.hoisted(() => ({
  BridgeError: class BridgeError extends Error {},
  createBridgePairing: vi.fn(),
  readBoundedBridgeJson: vi.fn(async (request: Request) => request.json()),
  bridgeErrorResponse: vi.fn(() => Response.json({ error: "failed" }, { status: 500 })),
}));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/bridge", () => bridge);

import { POST } from "./route";

describe("POST /api/bridge/pair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "user-session-1",
      principal: { userId: "initial-admin", role: "ADMIN" },
    });
    bridge.createBridgePairing.mockResolvedValue({
      pairingCode: "0101-0101-0101-0101",
      jobId: "job-1",
      expiresAt: "2026-08-24T09:35:00.000Z",
    });
  });

  it("requires the normal Archive owner session", async () => {
    auth.requireUserApiSession.mockResolvedValue(
      Response.json({ error: "Authentication required." }, { status: 401 }),
    );
    const response = await POST(pairRequest());
    expect(response.status).toBe(401);
    expect(bridge.createBridgePairing).not.toHaveBeenCalled();
  });

  it("binds the pairing to the authenticated owner session and Archive origin", async () => {
    const requestBody = {
      targetKind: "CHARACTER",
      platform: "JANITOR_AI",
      characterUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron",
    };
    const response = await POST(pairRequest(requestBody));
    expect(response.status).toBe(201);
    expect(bridge.createBridgePairing).toHaveBeenCalledWith(
      "user-session-1",
      "http://localhost:3000",
      requestBody,
    );
  });

  it("forwards an explicit profile discriminator and profile URL to authoritative service validation", async () => {
    const requestBody = {
      targetKind: "PROFILE",
      platform: "JANITOR_AI",
      profileUrl: "https://janitorai.com/profiles/9502024d-a6b5-4348-b556-31a37fbd6f2a_profile-of-owner",
    };
    const response = await POST(pairRequest(requestBody));
    expect(response.status).toBe(201);
    expect(bridge.createBridgePairing).toHaveBeenCalledWith(
      "user-session-1",
      "http://localhost:3000",
      requestBody,
    );
  });
});

function pairRequest(body: Record<string, unknown> = {
  targetKind: "CHARACTER",
  platform: "JANITOR_AI",
  characterUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7_character-theron",
}): Request {
  return new Request("http://localhost:3000/api/bridge/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
