import { describe, expect, it } from "vitest";
import { isArtifactUploadEnabled, readDeploymentCapabilities } from "./deployment";

describe("deployment capabilities", () => {
  it("preserves the accepted local importer in development", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "development" })).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    });
  });

  it("labels Vercel Preview and disables unproven deployed import paths", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toEqual({
      clientPreview: true,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    });
  });

  it("fails the artifact capability closed in every production runtime", () => {
    expect(isArtifactUploadEnabled({ NODE_ENV: "production" })).toBe(false);
    expect(isArtifactUploadEnabled({ NODE_ENV: "production", CHARACTER_ARCHIVE_RELEASE_CHANNEL: "client-preview" })).toBe(false);
  });
});
