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

  it("enables the importer in test environment without VERCEL_ENV", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "test" })).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    });
  });

  it("labels Vercel Preview and enables artifact imports in Preview", () => {
    expect(readDeploymentCapabilities({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toEqual({
      clientPreview: true,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    });
  });

  it("enables artifact imports when CHARACTER_ARCHIVE_RELEASE_CHANNEL is client-preview", () => {
    expect(
      readDeploymentCapabilities({
        NODE_ENV: "production",
        CHARACTER_ARCHIVE_RELEASE_CHANNEL: "client-preview",
      }),
    ).toEqual({
      clientPreview: true,
      artifactUploadsEnabled: true,
      experimentalImportsVisible: true,
    });
  });

  it("fails the artifact capability closed in Vercel production even if client-preview channel is set", () => {
    expect(
      readDeploymentCapabilities({
        NODE_ENV: "production",
        VERCEL_ENV: "production",
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
        VERCEL_ENV: "production",
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
        VERCEL_ENV: "unknown_stage",
      }),
    ).toEqual({
      clientPreview: false,
      artifactUploadsEnabled: false,
      experimentalImportsVisible: false,
    });
    expect(isArtifactUploadEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});
