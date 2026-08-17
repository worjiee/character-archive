import { describe, expect, it } from "vitest";
import {
  ImportRequestError,
  MAX_IMPORT_REQUEST_BYTES,
  getImportMethod,
  getSourceJson,
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
});
