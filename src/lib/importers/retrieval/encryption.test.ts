import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  getSourceEncryptionKey,
  SourceDecryptionError,
  SourceEncryptionKeyError,
} from "./encryption";

describe("Source Encryption (AES-256-GCM)", () => {
  const validKeyBase64 = crypto.randomBytes(32).toString("base64");
  const validKeyBuffer = Buffer.from(validKeyBase64, "base64");

  it("extracts and validates a 32-byte base64 encryption key", () => {
    const key = getSourceEncryptionKey({ SOURCE_ENCRYPTION_KEY: validKeyBase64 });
    expect(key.length).toBe(32);
  });

  it("throws SourceEncryptionKeyError when SOURCE_ENCRYPTION_KEY is missing", () => {
    expect(() => getSourceEncryptionKey({})).toThrow(SourceEncryptionKeyError);
  });

  it("throws SourceEncryptionKeyError when SOURCE_ENCRYPTION_KEY is invalid length", () => {
    const shortKey = crypto.randomBytes(16).toString("base64");
    expect(() => getSourceEncryptionKey({ SOURCE_ENCRYPTION_KEY: shortKey })).toThrow(
      SourceEncryptionKeyError,
    );
  });

  it("encrypts and decrypts a secret cleanly in round trip", () => {
    const plaintext = "my-secret-janitor-bearer-token-12345";
    const encrypted = encryptSecret(plaintext, validKeyBuffer);

    expect(encrypted.encryptedToken).toBeDefined();
    expect(encrypted.iv).toBeDefined();
    expect(encrypted.authTag).toBeDefined();
    expect(encrypted.encryptedToken).not.toBe(plaintext);

    const decrypted = decryptSecret(
      encrypted.encryptedToken,
      encrypted.iv,
      encrypted.authTag,
      validKeyBuffer,
    );
    expect(decrypted).toBe(plaintext);
  });

  it("generates a unique IV for each encryption call (never reuses IV)", () => {
    const plaintext = "repeated-token-value";
    const enc1 = encryptSecret(plaintext, validKeyBuffer);
    const enc2 = encryptSecret(plaintext, validKeyBuffer);

    expect(enc1.iv).not.toBe(enc2.iv);
    expect(enc1.encryptedToken).not.toBe(enc2.encryptedToken);
  });

  it("fails to decrypt when wrong key is provided", () => {
    const wrongKey = crypto.randomBytes(32);
    const encrypted = encryptSecret("test-secret", validKeyBuffer);

    expect(() =>
      decryptSecret(
        encrypted.encryptedToken,
        encrypted.iv,
        encrypted.authTag,
        wrongKey,
      ),
    ).toThrow(SourceDecryptionError);
  });

  it("fails to decrypt when ciphertext is tampered", () => {
    const encrypted = encryptSecret("test-secret", validKeyBuffer);
    const tamperedCiphertext =
      encrypted.encryptedToken.slice(0, -2) +
      (encrypted.encryptedToken.endsWith("aa") ? "bb" : "aa");

    expect(() =>
      decryptSecret(
        tamperedCiphertext,
        encrypted.iv,
        encrypted.authTag,
        validKeyBuffer,
      ),
    ).toThrow(SourceDecryptionError);
  });

  it("fails to decrypt when auth tag is tampered", () => {
    const encrypted = encryptSecret("test-secret", validKeyBuffer);
    const tamperedTag =
      encrypted.authTag.slice(0, -2) + (encrypted.authTag.endsWith("00") ? "11" : "00");

    expect(() =>
      decryptSecret(
        encrypted.encryptedToken,
        encrypted.iv,
        tamperedTag,
        validKeyBuffer,
      ),
    ).toThrow(SourceDecryptionError);
  });
});
