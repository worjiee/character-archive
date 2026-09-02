import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireUserApiSession: vi.fn(),
  getAuthenticatedUserApiSession: vi.fn(),
}));
const exporter = vi.hoisted(() => ({
  getCharacterExport: vi.fn(),
  characterExportFilename: vi.fn(() => "theron-dku-edition.json"),
}));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/characters/export", () => exporter);

import { GET } from "./route";

describe("GET /api/characters/:id/export/json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "user-session-1",
      principal: { userId: "initial-admin", username: "admin", displayName: "Admin", role: "ADMIN" },
    });
    exporter.getCharacterExport.mockResolvedValue({
      schema: "character-archive.normalized-character",
      version: 1,
      character: { name: "Theron | DKU edition" },
    });
  });

  it("requires the normal Character Archive owner session", async () => {
    auth.requireUserApiSession.mockResolvedValue(
      Response.json({ error: "Authentication required." }, { status: 401 }),
    );

    const response = await requestExport();

    expect(response.status).toBe(401);
    expect(exporter.getCharacterExport).not.toHaveBeenCalled();
  });

  it("returns the explicit JSON DTO as a private sanitized attachment", async () => {
    const response = await requestExport("character-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="theron-dku-edition.json"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(exporter.getCharacterExport).toHaveBeenCalledWith("character-1", expect.objectContaining({ userId: "initial-admin", role: "ADMIN" }));
    expect(exporter.characterExportFilename).toHaveBeenCalledWith("Theron | DKU edition");
    await expect(response.json()).resolves.toMatchObject({ version: 1, character: { name: "Theron | DKU edition" } });
  });

  it("returns a safe not-found response for absent or deleted characters", async () => {
    exporter.getCharacterExport.mockResolvedValue(null);
    const response = await requestExport("missing");
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "NOT_FOUND", message: "Character not found." } });
  });

  it("does not leak backend error details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exporter.getCharacterExport.mockRejectedValue(new Error("database path C:\\private\\archive"));
    const response = await requestExport();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":{"code":"EXPORT_FAILED","message":"The character export could not be prepared."}}');
    consoleError.mockRestore();
  });
});

function requestExport(id = "character-1"): Promise<Response> {
  return GET(
    new Request(`http://localhost:3000/api/characters/${id}/export/json`),
    { params: Promise.resolve({ id }) },
  );
}
