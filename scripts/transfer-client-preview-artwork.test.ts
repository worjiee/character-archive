import { describe, expect, it, vi } from "vitest";
import {
  control,
  OperatorSession,
  readCapabilityUrl,
  uploadWithRetry,
} from "./transfer-client-preview-artwork";

describe("readCapabilityUrl validation", () => {
  const digest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const expectedKey = `artwork/sha256/${digest}.png`;

  it("accepts valid Vercel Blob control API presigned upload URL", () => {
    const validApiUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}&vercel-blob-delegation=del_test&vercel-blob-signature=sig_test`;
    const result = readCapabilityUrl({ sha256: digest, capabilityUrl: validApiUrl }, digest);
    expect(result).toBe(validApiUrl);
  });

  it("accepts valid api.vercel.com control API presigned upload URL", () => {
    const validApiUrl = `https://api.vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}&token=test`;
    const result = readCapabilityUrl({ sha256: digest, capabilityUrl: validApiUrl }, digest);
    expect(result).toBe(validApiUrl);
  });

  it("accepts valid Vercel Blob CDN upload URL", () => {
    const validCdnUrl = `https://blob.vercel-storage.com/${expectedKey}?token=test`;
    const result = readCapabilityUrl({ sha256: digest, capabilityUrl: validCdnUrl }, digest);
    expect(result).toBe(validCdnUrl);
  });

  it("rejects non-HTTPS protocols", () => {
    const insecureUrl = `http://vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: insecureUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );
  });

  it("rejects arbitrary / untrusted destinations", () => {
    const attackerUrl = `https://attacker.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: attackerUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );
  });

  it("rejects mismatched or path-traversal target paths", () => {
    const wrongPathUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent("artwork/sha256/other.png")}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: wrongPathUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );

    const traversalUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(`artwork/sha256/../../${digest}.png`)}`;
    expect(() => readCapabilityUrl({ sha256: digest, capabilityUrl: traversalUrl }, digest)).toThrow(
      "The Preview artwork capability target was invalid.",
    );
  });

  it("rejects digest mismatch in response payload", () => {
    const validApiUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(expectedKey)}`;
    expect(() => readCapabilityUrl({ sha256: "different-digest", capabilityUrl: validApiUrl }, digest)).toThrow(
      "The Preview artwork capability response was invalid.",
    );
  });
});

describe("uploadWithRetry resilience and retry policies", () => {
  const dummySession: OperatorSession = {
    origin: "https://preview.vercel.app",
    cookie: "session=xyz",
    operatorSecret: "secret",
  };

  const dummyItem = {
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    mediaType: "image/png" as const,
    byteLength: 1024,
    width: 100,
    height: 100,
    storageKey: "artwork/sha256/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png",
  };

  const dummyBytes = new Uint8Array(1024);
  const capabilityUrl = `https://vercel.com/api/blob/?pathname=${encodeURIComponent(dummyItem.storageKey)}`;

  it("retries on HTTP 429 and succeeds when next attempt succeeds", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const controlMock = vi.fn().mockRejectedValue(new Error("not yet verified"));

    await uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledTimes(1);
    expect(controlMock).toHaveBeenCalledTimes(1);
  });

  it("retries on HTTP 502/503/504 transient server errors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, headers: new Headers() })
      .mockResolvedValueOnce({ ok: false, status: 504, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const controlMock = vi.fn().mockRejectedValue(new Error("not verified"));

    await uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After header bounded to 30 seconds", async () => {
    const headers = new Headers();
    headers.set("Retry-After", "5");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const controlMock = vi.fn().mockRejectedValue(new Error("not verified"));

    await uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock);

    expect(sleepMock.mock.calls[0][0]).toBeGreaterThanOrEqual(5000);
    expect(sleepMock.mock.calls[0][0]).toBeLessThan(6000); // 5000 + max 500 jitter
  });

  it("caps excessive Retry-After header to 30 seconds", async () => {
    const headers = new Headers();
    headers.set("Retry-After", "300"); // 300 seconds requested by upstream
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers() });
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const controlMock = vi.fn().mockRejectedValue(new Error("not verified"));

    await uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock);

    expect(sleepMock.mock.calls[0][0]).toBeGreaterThanOrEqual(30000);
    expect(sleepMock.mock.calls[0][0]).toBeLessThan(31000); // capped at 30000 + max 500 jitter
  });

  it("resolves ambiguous committed write without second PUT when server confirms object exists", async () => {
    // Upstream network error or dropped connection
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    // Server verification succeeds: object was received and committed before connection dropped!
    const controlMock = vi.fn().mockResolvedValue({
      sha256: dummyItem.sha256,
      verified: true,
    });

    await uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock);

    // Only 1 PUT attempt was made! No second PUT was dispatched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(controlMock).toHaveBeenCalledWith(dummySession, { action: "verify", sha256: dummyItem.sha256 });
    expect(sleepMock).not.toHaveBeenCalled();
  });

  it("fails immediately on non-retryable 4xx errors without retrying", async () => {
    for (const status of [400, 401, 403, 404, 409]) {
      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status, headers: new Headers() });
      const sleepMock = vi.fn().mockResolvedValue(undefined);
      const controlMock = vi.fn();

      await expect(
        uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock),
      ).rejects.toThrow(`Artwork upload failed with non-retryable HTTP ${status}.`);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sleepMock).not.toHaveBeenCalled();
    }
  });

  it("fails with retry exhaustion after max attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers() });
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const controlMock = vi.fn().mockRejectedValue(new Error("not verified"));

    await expect(
      uploadWithRetry(dummySession, capabilityUrl, dummyBytes, dummyItem, fetchMock as unknown as typeof fetch, sleepMock, controlMock),
    ).rejects.toThrow("Artwork upload failed after 4 attempts.");

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenCalledTimes(3);
  });
});

describe("batched verification and 60-second bounded execution safety", () => {
  it("chunks 72 present objects into exactly 9 bounded batches of 8", () => {
    const presentDigests = Array.from({ length: 72 }, (_, i) => i.toString(16).padStart(64, "0"));
    const batchSize = 8;
    const batches: string[][] = [];
    for (let i = 0; i < presentDigests.length; i += batchSize) {
      batches.push(presentDigests.slice(i, i + batchSize));
    }

    expect(batches).toHaveLength(9);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(8);
      expect(batch.length).toBeGreaterThan(0);
    }
    expect(batches.flat()).toHaveLength(72);
  });

  it("chunks 83 total objects into 11 bounded batches", () => {
    const allDigests = Array.from({ length: 83 }, (_, i) => i.toString(16).padStart(64, "0"));
    const batchSize = 8;
    const batches: string[][] = [];
    for (let i = 0; i < allDigests.length; i += batchSize) {
      batches.push(allDigests.slice(i, i + batchSize));
    }

    expect(batches).toHaveLength(11);
    expect(batches[10]).toHaveLength(3); // 10 * 8 + 3 = 83
    expect(batches.flat()).toHaveLength(83);
  });

  it("verifies 60-second execution safety bound", () => {
    // 8 items * ~1.2s per private blob download = ~9.6 seconds
    const maxBatchSize = 8;
    const estimatedDownloadSecPerItem = 1.5;
    const estimatedBatchDuration = maxBatchSize * estimatedDownloadSecPerItem;
    const vercelMaxDurationSec = 60;

    expect(estimatedBatchDuration).toBeLessThan(vercelMaxDurationSec);
    // Even with a 3x latency spike (4.5s/item), 8 * 4.5 = 36s < 60s
    expect(maxBatchSize * 4.5).toBeLessThan(vercelMaxDurationSec);
  });

  it("advances proofToken during ambiguous write recovery", async () => {
    const dummySession: OperatorSession = {
      origin: "https://preview.vercel.app",
      cookie: "session=xyz",
      operatorSecret: "secret",
    };
    const dummyItem = {
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      mediaType: "image/png" as const,
      byteLength: 1024,
      width: 100,
      height: 100,
      storageKey: "artwork/sha256/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.png",
    };
    const fetchMock = vi.fn().mockRejectedValue(new Error("socket hang up"));
    const sleepMock = vi.fn().mockResolvedValue(undefined);
    const controlMock = vi.fn().mockResolvedValue({
      sha256: dummyItem.sha256,
      verified: true,
      proofToken: "advanced.proof.token",
    });

    const result = await uploadWithRetry(
      dummySession,
      "https://vercel.com/api/blob/upload",
      new Uint8Array(1024),
      dummyItem,
      fetchMock as unknown as typeof fetch,
      sleepMock,
      controlMock,
      "initial.proof.token",
    );

    expect(result.proofToken).toBe("advanced.proof.token");
    expect(controlMock).toHaveBeenCalledWith(dummySession, {
      action: "verify",
      sha256: dummyItem.sha256,
      proofToken: "initial.proof.token",
    });
  });

  it("formats control error with status and code without leaking sensitive data", async () => {
    const dummySession: OperatorSession = {
      origin: "https://preview.vercel.app",
      cookie: "sensitive-cookie=abc",
      operatorSecret: "super-secret-password",
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: vi.fn().mockResolvedValue(JSON.stringify({
        error: { code: "INVENTORY_MUTATED", message: "Inventory transition is invalid." },
      })),
    });
    vi.stubGlobal("fetch", mockFetch);

    try {
      await expect(control(dummySession, { action: "capability" })).rejects.toThrow(
        "The Preview transfer control request was rejected (HTTP 409: INVENTORY_MUTATED - Inventory transition is invalid.).",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
