export interface DeploymentCapabilities {
  clientPreview: boolean;
  artifactUploadsEnabled: boolean;
  experimentalImportsVisible: boolean;
}

export function readDeploymentCapabilities(env: NodeJS.ProcessEnv = process.env): DeploymentCapabilities {
  const configuredStage = env.CHARACTER_ARCHIVE_DEPLOYMENT?.trim().toLowerCase();
  const isProduction = configuredStage === "production";
  const isPreview = configuredStage === "preview";
  if (isProduction || (configuredStage && !isPreview)) {
    return {
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    };
  }

  if (isPreview) {
    return {
      clientPreview: true,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    };
  }

  const isLocalDevOrTest = env.NODE_ENV === "development" || env.NODE_ENV === "test";

  if (isLocalDevOrTest) {
    return {
      clientPreview: false,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    };
  }

  // Fail closed when deployment context is ambiguous.
  return {
    clientPreview: false,
    artifactUploadsEnabled: false,
    experimentalImportsVisible: false,
  };
}

export function isArtifactUploadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDeploymentCapabilities(env).artifactUploadsEnabled;
}
