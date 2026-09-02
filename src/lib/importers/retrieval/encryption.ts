import crypto from "node:crypto";

export class SourceEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceEncryptionKeyError";
  }
}

export class SourceDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceDecryptionError";
  }
}

export interface EncryptedSecretPayload {
  encryptedToken: string;
  iv: string;
  authTag: string;
}

export function getSourceEncryptionKey(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Buffer {
  const rawKey = environment.SOURCE_ENCRYPTION_KEY?.trim();

  if (!rawKey) {
    throw new SourceEncryptionKeyError(
      "SOURCE_ENCRYPTION_KEY is not configured on this server.",
    );
  }

  const keyBuffer = Buffer.from(rawKey, "base64");
  if (keyBuffer.length !== 32) {
    throw new SourceEncryptionKeyError(
      "SOURCE_ENCRYPTION_KEY must be a valid base64-encoded 32-byte key.",
    );
  }

  return keyBuffer;
}

export function encryptSecret(
  plaintext: string,
  keyOverride?: Buffer,
): EncryptedSecretPayload {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("Secret to encrypt must be a non-empty string.");
  }

  const key = keyOverride ?? getSourceEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  const encryptedBuffer = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encryptedToken: encryptedBuffer.toString("hex"),
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

export function decryptSecret(
  encryptedToken: string,
  ivHex: string,
  authTagHex: string,
  keyOverride?: Buffer,
): string {
  if (!encryptedToken || !ivHex || !authTagHex) {
    throw new SourceDecryptionError("Missing required decryption parameters.");
  }

  const key = keyOverride ?? getSourceEncryptionKey();

  try {
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encryptedData = Buffer.from(encryptedToken, "hex");

    if (iv.length !== 12) {
      throw new SourceDecryptionError("Invalid initialization vector length.");
    }
    if (authTag.length !== 16) {
      throw new SourceDecryptionError("Invalid authentication tag length.");
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    if (error instanceof SourceDecryptionError) throw error;
    throw new SourceDecryptionError("Failed to decrypt source credential: tag mismatch or corrupted data.");
  }
}