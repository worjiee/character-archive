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

  it("enables the importer in test environment without deployment configuration", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "test" })).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    });
  });

  it("enables the importer for an explicit Preview deployment", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "production", CHARACTER_ARCHIVE_DEPLOYMENT: "preview" })).toEqual({
      clientPreview: true,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    });
  });

  it("does not treat the release channel as deployment configuration", () => {
    expect(
      readDeploymentCapabilities({
        NODE_ENV: "production",
        CHARACTER_ARCHIVE_RELEASE_CHANNEL: "client-preview",
      }),
    ).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    });
  });

  it("fails the artifact capability closed in explicit production even if client-preview channel is set", () => {
    expect(
      readDeploymentCapabilities({
        NODE_ENV: "production",
        CHARACTER_ARCHIVE_DEPLOYMENT: "production",
        CHARACTER_ARCHIVE_RELEASE_CHANNEL: "client-preview",
      }),
    ).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    });
    expect(
      isArtifactUploadEnabled({
        NODE_ENV: "production",
        CHARACTER_ARCHIVE_DEPLOYMENT: "production",
      }),
    ).toBe(false);
  });

  it("fails closed when deployment context is ambiguous", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "production" })).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    });
    expect(
      readDeploymentCapabilities({
        NODE_ENV: "production",
        CHARACTER_ARCHIVE_DEPLOYMENT: "unknown_stage",
      }),
    ).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    });
    expect(isArtifactUploadEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
