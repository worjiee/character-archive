import { describe, expect, it } from "vitest";
import { generateOwnerPasswordHash, verifyOwnerCredentials } from "./password";

describe("owner credentials", () => {
  it("accepts a valid owner login case-insensitively", async () => {
    const hash = await generateOwnerPasswordHash("correct horse battery staple");
    await expect(verifyOwnerCredentials(
      " OWNER@EXAMPLE.COM ",
      "correct horse battery staple",
      "owner@example.com",
      hash,
    )).resolves.toBe(true);
  });

  it("returns the same false result for an invalid username or password", async () => {
    const hash = await generateOwnerPasswordHash("correct horse battery staple");
    await expect(verifyOwnerCredentials("other@example.com", "correct horse battery staple", "owner@example.com", hash)).resolves.toBe(false);
    await expect(verifyOwnerCredentials("owner@example.com", "incorrect password", "owner@example.com", hash)).resolves.toBe(false);
  });
});
