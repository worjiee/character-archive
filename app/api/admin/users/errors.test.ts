import { describe, expect, it } from "vitest";
import { UserManagementError } from "../../../../src/lib/users/access-management";
import { readUserManagementJson, userManagementErrorResponse } from "./errors";

describe("user-management API errors", () => {
  it("rejects malformed JSON without exposing parser details", async () => {
    const request = new Request("http://localhost/api/admin/users", { method: "POST", body: "{" });
    await expect(readUserManagementJson(request)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("returns controlled codes and a generic unexpected failure", async () => {
    const controlled = userManagementErrorResponse(new UserManagementError("USERNAME_TAKEN", "That username is already in use.", 409));
    expect(controlled.status).toBe(409);
    await expect(controlled.json()).resolves.toEqual({ error: { code: "USERNAME_TAKEN", message: "That username is already in use." } });

    const unexpected = userManagementErrorResponse(new Error("database path and secret"));
    expect(unexpected.status).toBe(500);
    expect(JSON.stringify(await unexpected.json())).not.toContain("database path and secret");
  });
});
