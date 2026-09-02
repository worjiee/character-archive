export interface InitialAdminBootstrapConfig {
  username: string;
  passwordHash: string;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export function getInitialAdminBootstrapConfig(
  environment: NodeJS.ProcessEnv = process.env,
): InitialAdminBootstrapConfig {
  const username = environment.OWNER_USERNAME?.trim();
  const passwordHash = environment.OWNER_PASSWORD_HASH?.trim();

  if (!username) throw new AuthConfigurationError("OWNER_USERNAME is not configured.");
  if (!passwordHash) throw new AuthConfigurationError("OWNER_PASSWORD_HASH is not configured.");

  return { username, passwordHash };
}
