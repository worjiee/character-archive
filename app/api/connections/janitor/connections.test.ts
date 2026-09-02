import { describe, expect, it, vi } from "vitest";
import { GET as getStatus } from "./status/route";
import { DELETE as deleteConnection, POST as postConnection } from "./route";

const mockStatus = {
  connected: false,
  platform: "JANITOR_AI" as const,
  expiresAt: null,
  updatedAt: null,
};

vi.mock("../../../../src/lib/importers/retrieval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/lib/importers/retrieval")>();
  return {
    ...actual,
    defaultCredentialProvider: {
      getConnectionStatus: vi.fn(async () => mockStatus),
      setCredential: vi.fn(async () => {
        mockStatus.connected = true;
      }),
      revokeCredential: vi.fn(async () => {
        mockStatus.connected = false;
      }),
    },
  };
});

vi.mock("../../../../src/lib/auth", () => ({
  requireAdminApiSession: vi.fn(async (req: Request) => {
    if (req.headers.get("x-mock-auth") === "authenticated") return null;
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }),
}));

describe("Connection API Routes (/api/connections/janitor)", () => {
  function createAuthenticatedRequest(
    url: string,
    init: RequestInit = {},
  ): Request {
    const headers = new Headers(init.headers);
    headers.set("x-mock-auth", "authenticated");
    return new Request(url, { ...init, headers });
  }

  it("rejects unauthenticated requests with 401", async () => {
    const unauthGet = new Request("http://localhost/api/connections/janitor/status");
    const getRes = await getStatus(unauthGet);
    expect(getRes.status).toBe(401);

    const unauthPost = new Request("http://localhost/api/connections/janitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "test-token" }),
    });
    const postRes = await postConnection(unauthPost);
    expect(postRes.status).toBe(401);

    const unauthDelete = new Request("http://localhost/api/connections/janitor", {
      method: "DELETE",
    });
    const deleteRes = await deleteConnection(unauthDelete);
    expect(deleteRes.status).toBe(401);
  });

  it("handles full connect, status check, and disconnect cycle securely", async () => {
    // 1. Post connection
    const postReq = createAuthenticatedRequest("http://localhost/api/connections/janitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "Bearer sample-janitor-token-12345" }),
    });
    const postRes = await postConnection(postReq);
    expect(postRes.status).toBe(200);
    const postData = await postRes.json();
    expect(postData).toEqual({ success: true, connected: true });
    // Invariant: no secrets or ciphertexts exposed
    expect(postData).not.toHaveProperty("token");
    expect(postData).not.toHaveProperty("encryptedToken");
    expect(postData).not.toHaveProperty("iv");
    expect(postData).not.toHaveProperty("authTag");

    // 2. Check status
    const statusReq = createAuthenticatedRequest(
      "http://localhost/api/connections/janitor/status",
    );
    const statusRes = await getStatus(statusReq);
    expect(statusRes.status).toBe(200);
    const statusData = await statusRes.json();
    expect(statusData.connected).toBe(true);
    expect(statusData.platform).toBe("JANITOR_AI");
    // Invariant: no secrets or ciphertexts exposed
    expect(statusData).not.toHaveProperty("token");
    expect(statusData).not.toHaveProperty("encryptedToken");
    expect(statusData).not.toHaveProperty("iv");
    expect(statusData).not.toHaveProperty("authTag");

    // 3. Disconnect
    const deleteReq = createAuthenticatedRequest(
      "http://localhost/api/connections/janitor",
      { method: "DELETE" },
    );
    const deleteRes = await deleteConnection(deleteReq);
    expect(deleteRes.status).toBe(200);
    const deleteData = await deleteRes.json();
    expect(deleteData).toEqual({ success: true, connected: false });

    // 4. Verify post-disconnect status
    const postDeleteStatusRes = await getStatus(statusReq);
    const postDeleteStatusData = await postDeleteStatusRes.json();
    expect(postDeleteStatusData.connected).toBe(false);
  });

  it("rejects invalid token payloads on POST", async () => {
    const emptyReq = createAuthenticatedRequest("http://localhost/api/connections/janitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notToken: "abc" }),
    });
    const emptyRes = await postConnection(emptyReq);
    expect(emptyRes.status).toBe(400);

    const invalidDateReq = createAuthenticatedRequest(
      "http://localhost/api/connections/janitor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "good-token", expiresAt: "invalid-date" }),
      },
    );
    const invalidDateRes = await postConnection(invalidDateReq);
    expect(invalidDateRes.status).toBe(400);
  });

  it("maps unexpected persistence failures to safe owner-facing 500 error", async () => {
    const errorReq = createAuthenticatedRequest(
      "http://localhost/api/connections/janitor",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "error-trigger-token" }),
      },
    );

    const retrieval = await import("../../../../src/lib/importers/retrieval");
    vi.spyOn(retrieval.defaultCredentialProvider, "setCredential").mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'upsert')"),
    );

    const res = await postConnection(errorReq);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data).toEqual({
      error: {
        code: "CONNECTION_FAILED",
        message: "Unable to save source connection.",
      },
    });
    // Invariant: raw runtime error string never leaked to client
    expect(JSON.stringify(data)).not.toContain("upsert");
    expect(JSON.stringify(data)).not.toContain("undefined");
  });
});
