import { describe, expect, it } from "vitest";
import {
  generateOwnerPasswordHash,
  OwnerPasswordHashError,
  verifyOwnerCredentials,
} from "./password";

describe("owner credentials", () => {
  it("generates a dotenv-safe password hash", async () => {
    const hash = await generateOwnerPasswordHash("correct horse battery staple");

    expect(hash).toMatch(/^scrypt:/u);
    expect(hash).not.toContain("$");
  });

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

  it("continues to verify legacy dollar-delimited hashes", async () => {
    const hash = await generateOwnerPasswordHash("correct horse battery staple");
    const [algorithm, parameters, salt, key] = hash.split(":");
    const legacyHash = `$${algorithm}$${parameters}$${salt}$${key}`;

    await expect(verifyOwnerCredentials(
      "owner@example.com",
      "correct horse battery staple",
      "owner@example.com",
      legacyHash,
    )).resolves.toBe(true);
  });

  it("rejects a legacy hash with an unexpected prefix", async () => {
    const hash = await generateOwnerPasswordHash("correct horse battery staple");
    const [algorithm, parameters, salt, key] = hash.split(":");

    await expect(verifyOwnerCredentials(
      "owner@example.com",
      "correct horse battery staple",
      "owner@example.com",
      `unexpected$${algorithm}$${parameters}$${salt}$${key}`,
    )).rejects.toBeInstanceOf(OwnerPasswordHashError);
  });
});
