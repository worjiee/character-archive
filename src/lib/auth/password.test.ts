import { describe, expect, it } from "vitest";
import {
  generatePasswordHash,
  normalizeUsername,
  PasswordHashError,
  verifyPassword,
} from "./password";

describe("user credentials", () => {
  it("preserves normalized usernames and dotenv-safe scrypt hashes", async () => {
    const hash = await generatePasswordHash("correct horse battery staple");
    expect(normalizeUsername(" OWNER@EXAMPLE.COM ")).toBe("owner@example.com");
    expect(hash).toMatch(/^scrypt:/u);
    expect(hash).not.toContain("$");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("returns false for a wrong password", async () => {
    const hash = await generatePasswordHash("correct horse battery staple");
    await expect(verifyPassword("incorrect password", hash)).resolves.toBe(false);
  });

  it("continues to verify legacy dollar-delimited hashes", async () => {
    const hash = await generatePasswordHash("correct horse battery staple");
    const [algorithm, parameters, salt, key] = hash.split(":");
    const legacyHash = `$${algorithm}$${parameters}$${salt}$${key}`;
    await expect(verifyPassword("correct horse battery staple", legacyHash)).resolves.toBe(true);
  });

  it("rejects malformed password hashes", async () => {
    await expect(verifyPassword("password", "not-a-hash")).rejects.toBeInstanceOf(PasswordHashError);
  });
});
