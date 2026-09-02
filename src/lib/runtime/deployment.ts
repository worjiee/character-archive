export interface DeploymentCapabilities {
  clientPreview: boolean;
  artifactUploadsEnabled: boolean;
  experimentalImportsVisible: boolean;
}

export function readDeploymentCapabilities(env: NodeJS.ProcessEnv = process.env): DeploymentCapabilities {
  const clientPreview = env.VERCEL_ENV === "preview" || env.CHARACTER_ARCHIVE_RELEASE_CHANNEL === "client-preview";
  const productionRuntime = env.NODE_ENV === "production";
  return {
    clientPreview,
    artifactUploadsEnabled: !productionRuntime,
    experimentalImportsVisible: !productionRuntime,
  };
}

export function isArtifactUploadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDeploymentCapabilities(env).artifactUploadsEnabled;
}
