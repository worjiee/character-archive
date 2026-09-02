import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const DEFAULT_LOG_N = 14;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

interface ScryptParameters {
  logN: number;
  r: number;
  p: number;
}

export class PasswordHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordHashError";
  }
}

export async function generatePasswordHash(
  password: string,
  parameters: ScryptParameters = {
    logN: DEFAULT_LOG_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
  },
): Promise<string> {
  if (password.length < 12) {
    throw new PasswordHashError("The password must contain at least 12 characters.");
  }
  validateParameters(parameters);
  const salt = randomBytes(16);
  const derived = await deriveScrypt(password, salt, parameters);
  return `scrypt:ln=${parameters.logN},r=${parameters.r},p=${parameters.p}:${salt.toString("base64url")}:${derived.toString("base64url")}`;
}

export async function verifyPassword(
  suppliedPassword: unknown,
  passwordHash: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(passwordHash);
  const password = typeof suppliedPassword === "string" && suppliedPassword.length <= 1024
    ? suppliedPassword
    : "";

  const derived = await deriveScrypt(password, parsed.salt, parsed.parameters);
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}

export function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

export function validatePasswordHash(value: string): void {
  parsePasswordHash(value);
}

function parsePasswordHash(value: string): {
  parameters: ScryptParameters;
  salt: Buffer;
  hash: Buffer;
} {
  const parts = value.startsWith("scrypt:")
    ? value.split(":")
    : value.startsWith("$scrypt$")
      ? value.split("$").slice(1)
      : [];
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    throw new PasswordHashError("The password hash is not a supported scrypt hash.");
  }

  const parameterMatch = /^ln=(\d+),r=(\d+),p=(\d+)$/u.exec(parts[1]);
  if (!parameterMatch) throw new PasswordHashError("The password hash has invalid parameters.");
  const parameters = {
    logN: Number(parameterMatch[1]),
    r: Number(parameterMatch[2]),
    p: Number(parameterMatch[3]),
  };
  validateParameters(parameters);

  const salt = decodeBase64Url(parts[2]);
  const hash = decodeBase64Url(parts[3]);
  if (salt.length < 16 || hash.length !== KEY_LENGTH) {
    throw new PasswordHashError("The password hash has invalid salt or key material.");
  }
  return { parameters, salt, hash };
}

function validateParameters(parameters: ScryptParameters): void {
  if (
    !Number.isInteger(parameters.logN) || parameters.logN < 14 || parameters.logN > 20 ||
    !Number.isInteger(parameters.r) || parameters.r < 8 || parameters.r > 32 ||
    !Number.isInteger(parameters.p) || parameters.p < 1 || parameters.p > 8
  ) {
    throw new PasswordHashError("Scrypt parameters are outside the supported security bounds.");
  }
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new PasswordHashError("The password hash contains invalid encoding.");
  }
  return Buffer.from(value, "base64url");
}

function deriveScrypt(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, KEY_LENGTH, {
      N: 2 ** parameters.logN,
      r: parameters.r,
      p: parameters.p,
      maxmem: MAX_MEMORY,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
