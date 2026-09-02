import { describe, expect, it } from "vitest";
import {
  ImportRequestError,
  MAX_IMPORT_REQUEST_BYTES,
  getImportMethod,
  getLinkSelection,
  getSourceJson,
  importErrorResponse,
  readJson,
} from "./errors";

describe("import request validation", () => {
  it("accepts the manual import method and source JSON string", () => {
    const body = { method: "manual-json", sourceJson: "{}" };
    expect(getImportMethod(body)).toBe("manual-json");
    expect(getSourceJson(body)).toBe("{}");
  });

  it("defaults legacy requests to automatic URL import", () => {
    expect(getImportMethod({ url: "https://janitorai.com/characters/example" })).toBe("automatic-url");
  });

  it("rejects malformed request JSON", async () => {
    const request = new Request("http://localhost/api/import/preview", { method: "POST", body: "{" });
    await expect(readJson(request)).rejects.toMatchObject({ code: "INVALID_REQUEST_JSON" });
  });

  it("rejects a streamed request larger than the limit", async () => {
    const request = new Request("http://localhost/api/import/preview", {
      method: "POST",
      body: "x".repeat(MAX_IMPORT_REQUEST_BYTES + 1),
    });
    await expect(readJson(request)).rejects.toEqual(expect.objectContaining<Partial<ImportRequestError>>({
      code: "IMPORT_PAYLOAD_TOO_LARGE",
      status: 413,
    }));
  });

  it("validates linkSelection parameters safely", () => {
    expect(getLinkSelection({})).toEqual({});
    expect(getLinkSelection({ linkMode: "CREATE_SEPARATE" })).toEqual({
      linkMode: "CREATE_SEPARATE",
    });
    expect(
      getLinkSelection({
        linkMode: "ATTACH_TO_EXISTING",
        targetCharacterId: "char-123",
      }),
    ).toEqual({
      linkMode: "ATTACH_TO_EXISTING",
      targetCharacterId: "char-123",
    });

    expect(() =>
      getLinkSelection({
        linkMode: "CREATE_SEPARATE",
        targetCharacterId: "char-123",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LINK_SELECTION",
        status: 400,
      }),
    );

    expect(() =>
      getLinkSelection({ linkMode: "ATTACH_TO_EXISTING" }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LINK_SELECTION",
        status: 400,
      }),
    );

    expect(() =>
      getLinkSelection({ targetCharacterId: "char-123" }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LINK_SELECTION",
        status: 400,
      }),
    );

    expect(() =>
      getLinkSelection({ linkMode: "INVALID_MODE" }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_LINK_SELECTION",
        status: 400,
      }),
    );
  });

  it("maps source linking errors to safe HTTP responses", async () => {
    const {
      TargetCharacterNotFoundError,
      TargetCharacterDeletedError,
      SourceAlreadyAttachedElsewhereError,
      LinkConflictError,
    } = await import("../../../src/lib/importers/persistence");

    const notFoundRes = importErrorResponse(new TargetCharacterNotFoundError(), true);
    expect(notFoundRes.status).toBe(404);
    await expect(notFoundRes.json()).resolves.toEqual({
      error: {
        code: "TARGET_CHARACTER_NOT_FOUND",
        message: "Target character not found.",
      },
    });

    const deletedRes = importErrorResponse(new TargetCharacterDeletedError(), true);
    expect(deletedRes.status).toBe(404);
    await expect(deletedRes.json()).resolves.toEqual({
      error: {
        code: "TARGET_CHARACTER_DELETED",
        message: "Target character is deleted.",
      },
    });

    const conflictRes = importErrorResponse(
      new SourceAlreadyAttachedElsewhereError(),
      true,
    );
    expect(conflictRes.status).toBe(409);
    await expect(conflictRes.json()).resolves.toEqual({
      error: {
        code: "SOURCE_ALREADY_ATTACHED_ELSEWHERE",
        message: "This source is already attached to a different character.",
      },
    });

    const linkConflictRes = importErrorResponse(new LinkConflictError(), true);
    expect(linkConflictRes.status).toBe(409);
    await expect(linkConflictRes.json()).resolves.toEqual({
      error: {
        code: "LINK_CONFLICT",
        message: "The requested source link could not be completed due to a conflict.",
      },
    });
  });

  it("maps SourceRetrievalError codes to safe HTTP responses", async () => {
    const { SourceRetrievalError } = await import("../../../src/lib/importers/retrieval");

    const cases = [
      { code: "NOT_FOUND", status: 404 },
      { code: "AUTH_REQUIRED", status: 401 },
      { code: "RATE_LIMITED", status: 429 },
      { code: "INVALID_SOURCE_PAYLOAD", status: 422 },
      { code: "SOURCE_UNAVAILABLE", status: 503 },
      { code: "RETRIEVAL_TIMEOUT", status: 503 },
      { code: "UNSUPPORTED_SOURCE", status: 400 },
      { code: "INVALID_URL", status: 400 },
    ];

    for (const { code, status } of cases) {
      const error = new SourceRetrievalError("JANITOR_AI", code, `Error message for ${code}`);
      const res = importErrorResponse(error);
      expect(res.status).toBe(status);
      await expect(res.json()).resolves.toEqual({
        error: {
          code,
          message: `Error message for ${code}`,
        },
      });
    }
  });

  it("maps bridge job errors to their controlled public code and status", async () => {
    const { BridgeError } = await import("../../../src/lib/bridge/errors");
    const response = importErrorResponse(
      new BridgeError("BRIDGE_JOB_EXPIRED", "The bridge job expired.", 410),
      true,
    );

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BRIDGE_JOB_EXPIRED", message: "The bridge job expired." },
    });
  });
});
