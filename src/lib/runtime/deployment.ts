export interface DeploymentCapabilities {
  clientPreview: boolean;
  artifactUploadsEnabled: boolean;
  experimentalImportsVisible: boolean;
}

export function readDeploymentCapabilities(env: NodeJS.ProcessEnv = process.env): DeploymentCapabilities {
  const isVercelProduction = env.VERCEL_ENV === "production";
  if (isVercelProduction) {
    return {
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    };
  }

  const isVercelPreview =
    env.VERCEL_ENV === "preview" ||
    env.CHARACTER_ARCHIVE_RELEASE_CHANNEL === "client-preview";

  if (isVercelPreview) {
    return {
      clientPreview: true,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    };
  }

  const isLocalDevOrTest =
    !env.VERCEL_ENV &&
    (env.NODE_ENV === "development" || env.NODE_ENV === "test");

  if (isLocalDevOrTest) {
    return {
      clientPreview: false,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    };
  }

  // Fail closed when deployment context is ambiguous
  return {
    clientPreview: false,
    artifactUploadsEnabled: false,
    experimentalImportsVisible: false,
  };
}

export function isArtifactUploadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDeploymentCapabilities(env).artifactUploadsEnabled;
}
