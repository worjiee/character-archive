import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BackupRecoveryDashboard } from "./backup-recovery-dashboard";
import type { ArchiveHealthStatus } from "@/src/lib/backup/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const MOCK_HEALTH: ArchiveHealthStatus = {
  database: {
    status: "healthy",
    totalCharacters: 355,
    totalSources: 355,
    totalVersions: 355,
    totalGreetings: 990,
    totalTags: 50,
    totalLorebooks: 67,
  },
  artwork: {
    totalAssets: 350,
    totalBytes: 371700000,
    storageObjects: 350,
    missingCurrentArtwork: [],
    brokenHistoricalArtwork: [],
    orphanArtwork: [],
    storageMismatch: [],
  },
  migrations: {
    isUpToDate: true,
    appliedCount: 15,
    latestMigration: "20260914_version_baseline",
  },
  operational: {
    sessionCount: 2,
    notificationCount: 0,
  },
};

describe("BackupRecoveryDashboard", () => {
  it("renders backup and recovery administration interface with dynamic counts and zero-egress status", () => {
    const html = renderToStaticMarkup(
      createElement(BackupRecoveryDashboard, { initialHealth: MOCK_HEALTH }),
    );

    expect(html).toContain("Backup &amp; Recovery Center");
    expect(html).toContain("All Systems Verified");
    expect(html).toContain("355");
    expect(html).toContain("350");
    expect(html).toContain("990");
    expect(html).toContain("67");
    expect(html).toContain("20260914_version_baseline");

    // Zero-egress integrity checks
    expect(html).toContain("Missing Current Artwork");
    expect(html).toContain("Broken Historical Refs");
    expect(html).toContain("Orphan Artwork Assets");
    expect(html).toContain("Storage Mismatches");

    // CLI guides
    expect(html).toContain("npm run backup:create");
    expect(html).toContain("npm run backup:verify");
    expect(html).toContain("npm run backup:restore");

    // Manifest Inspector
    expect(html).toContain("Manifest Inspector &amp; Validator");
    expect(html).toContain('href="/settings/backups"');
  });

  it("indicates review attention needed if integrity issues exist", () => {
    const degradedHealth: ArchiveHealthStatus = {
      ...MOCK_HEALTH,
      artwork: {
        ...MOCK_HEALTH.artwork,
        missingCurrentArtwork: ["missing-sha"],
      },
    };

    const html = renderToStaticMarkup(
      createElement(BackupRecoveryDashboard, { initialHealth: degradedHealth }),
    );

    expect(html).toContain("Review Attention Needed");
    expect(html).toContain("Missing Current Artwork");
  });
});
