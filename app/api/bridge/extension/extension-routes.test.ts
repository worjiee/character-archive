import { beforeEach, describe, expect, it, vi } from "vitest";

const extensionOrigin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const bridge = vi.hoisted(() => ({
  BridgeError: class BridgeError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  },
  bridgeErrorResponse: vi.fn((error: { code?: string; message?: string; status?: number }) =>
    Response.json({ error: { code: error.code ?? "BRIDGE_FAILED", message: error.message ?? "failed" } }, { status: error.status ?? 500 })),
  bridgeExchangeRateLimiter: { consume: vi.fn(() => ({ limited: false, retryAfterSeconds: 0 })), clear: vi.fn() },
  bridgeRateLimitKey: vi.fn(() => "test-rate-key"),
  companionPreflight: vi.fn(() => new Response(null, { status: 204 })),
  readBoundedBridgeJson: vi.fn(async (request: Request) => request.json()),
  requireCompanionOrigin: vi.fn(() => extensionOrigin),
  withCompanionCors: vi.fn((_request: Request, response: Response) => response),
  exchangeBridgePairing: vi.fn(),
  receiveBridgeCharacter: vi.fn(),
}));

vi.mock("@/src/lib/bridge", () => bridge);

import { POST as importCharacter } from "./import/route";
import { POST as exchangePairing } from "./pair/exchange/route";

describe("Chrome companion bridge routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bridge.bridgeExchangeRateLimiter.consume.mockReturnValue({ limited: false, retryAfterSeconds: 0 });
    bridge.bridgeRateLimitKey.mockReturnValue("test-rate-key");
    bridge.readBoundedBridgeJson.mockImplementation(async (request: Request) => request.json());
    bridge.withCompanionCors.mockImplementation((_request: Request, response: Response) => response);
    bridge.requireCompanionOrigin.mockReturnValue(extensionOrigin);
  });

  it("exchanges a one-time pairing only from the configured extension origin", async () => {
    bridge.exchangeBridgePairing.mockResolvedValue({
      bridgeToken: "t".repeat(43),
      jobId: "job-1",
      expiresAt: "2026-08-24T10:10:00.000Z",
      target: {
        targetKind: "CHARACTER",
        platform: "JANITOR_AI",
        externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
        canonicalSourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
        pageOrigin: "https://janitorai.com",
      },
    });
    const response = await exchangePairing(new Request("http://localhost:3000/api/bridge/extension/pair/exchange", {
      method: "POST",
      headers: { Origin: extensionOrigin, "Content-Type": "application/json", "X-Forwarded-For": "192.0.2.10" },
      body: JSON.stringify({
        pairingCode: "0101-0101-0101-0101",
        bridgeVersion: 1,
        operation: "CHARACTER_IMPORT",
        target: {
          targetKind: "CHARACTER",
          platform: "JANITOR_AI",
          externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
          canonicalSourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
          pageOrigin: "https://janitorai.com",
        },
      }),
    }));
    expect(response.status).toBe(200);
    expect(bridge.requireCompanionOrigin).toHaveBeenCalled();
    expect(bridge.exchangeBridgePairing).toHaveBeenCalledWith("0101-0101-0101-0101", "http://localhost:3000", {
      capabilityOrigin: extensionOrigin,
      presentedTarget: expect.objectContaining({ externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7" }),
    });
  });

  it("reuses authoritative receive validation and creates no direct persistence path", async () => {
    bridge.receiveBridgeCharacter.mockResolvedValue({ jobId: "job-1", previewJobId: "preview-job-123456", preview: { name: "Theron" } });
    const envelope = { bridgeVersion: 1, platform: "JANITOR_AI", type: "CHARACTER" };
    const response = await importCharacter(new Request("http://localhost:3000/api/bridge/extension/import", {
      method: "POST",
      headers: {
        Origin: extensionOrigin,
        "Content-Type": "application/json",
        "X-Archive-Bridge-Token": "t".repeat(43),
      },
      body: JSON.stringify(envelope),
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ jobId: "job-1", previewJobId: "preview-job-123456", status: "READY" });
    expect(bridge.receiveBridgeCharacter).toHaveBeenCalledWith("t".repeat(43), envelope, "http://localhost:3000", {
      capabilityOrigin: extensionOrigin,
    });
  });

  it("rejects an unconfigured extension before pairing or receipt", async () => {
    bridge.requireCompanionOrigin.mockImplementation(() => {
      throw new bridge.BridgeError("COMPANION_ORIGIN_NOT_ALLOWED", "not allowed", 403);
    });
    const headers = { Origin: "chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba", "Content-Type": "application/json" };
    const pairResponse = await exchangePairing(new Request("http://localhost:3000/api/bridge/extension/pair/exchange", {
      method: "POST",
      headers,
      body: "{}",
    }));
    const importResponse = await importCharacter(new Request("http://localhost:3000/api/bridge/extension/import", {
      method: "POST",
      headers,
      body: "{}",
    }));
    expect(pairResponse.status).toBe(403);
    expect(importResponse.status).toBe(403);
    expect(bridge.exchangeBridgePairing).not.toHaveBeenCalled();
    expect(bridge.receiveBridgeCharacter).not.toHaveBeenCalled();
  });
});
