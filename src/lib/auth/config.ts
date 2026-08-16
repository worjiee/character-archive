export interface OwnerAuthConfig {
  username: string;
  passwordHash: string;
  sessionSecret: string;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function getOwnerAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OwnerAuthConfig {
  const username = environment.OWNER_USERNAME?.trim();
  const passwordHash = environment.OWNER_PASSWORD_HASH?.trim();
  const sessionSecret = environment.AUTH_SESSION_SECRET?.trim();

  if (!username) throw new AuthConfigurationError("OWNER_USERNAME is not configured.");
  if (!passwordHash) throw new AuthConfigurationError("OWNER_PASSWORD_HASH is not configured.");
  if (!sessionSecret || new TextEncoder().encode(sessionSecret).byteLength < 32) {
    throw new AuthConfigurationError("AUTH_SESSION_SECRET must contain at least 32 bytes.");
  }

  return { username, passwordHash, sessionSecret };
}
