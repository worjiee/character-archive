import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  character: { count: vi.fn() },
  characterSource: { count: vi.fn() },
  characterVersion: { count: vi.fn() },
  greeting: { count: vi.fn() },
  tag: { count: vi.fn() },
  lorebook: { count: vi.fn() },
  artworkAsset: {
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
  userSession: { count: vi.fn() },
  notification: { count: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  computePackageDigest,
  getArchiveHealth,
  validateBackupManifest,
  verifyBackupDirectory,
} from "./service";
import type { BackupManifest } from "./types";

describe("Backup & Recovery Service Layer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("computePackageDigest", () => {
    it("computes identical digests regardless of input array ordering", () => {
      const partsA = [
        { relativePath: "database.dump", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { relativePath: "artwork/111.png", sha256: "1111111111111111111111111111111111111111111111111111111111111111" },
        { relativePath: "artwork/222.png", sha256: "2222222222222222222222222222222222222222222222222222222222222222" },
      ];
      const partsB = [
        { relativePath: "artwork/222.png", sha256: "2222222222222222222222222222222222222222222222222222222222222222" },
        { relativePath: "database.dump", sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
        { relativePath: "artwork/111.png", sha256: "1111111111111111111111111111111111111111111111111111111111111111" },
      ];

      expect(computePackageDigest(partsA)).toBe(computePackageDigest(partsB));
    });
  });

  describe("getArchiveHealth", () => {
    it("computes dynamic counts and zero-egress cross-reference checks", async () => {
      mockPrisma.character.count.mockResolvedValue(355);
      mockPrisma.characterSource.count.mockResolvedValue(355);
      mockPrisma.characterVersion.count.mockResolvedValue(355);
      mockPrisma.greeting.count.mockResolvedValue(990);
      mockPrisma.tag.count.mockResolvedValue(50);
      mockPrisma.lorebook.count.mockResolvedValue(67);
      mockPrisma.artworkAsset.aggregate.mockResolvedValue({
        _count: { sha256: 350 },
        _sum: { byteLength: 371700000 },
      });
      mockPrisma.userSession.count.mockResolvedValue(2);
      mockPrisma.notification.count.mockResolvedValue(0);

      // Raw queries for missing/broken/orphans
      mockPrisma.$queryRaw
        .mockResolvedValueOnce([]) // missingCurrentRows
        .mockResolvedValueOnce([]) // brokenHistoricalRows
        .mockResolvedValueOnce([]) // orphanRows
        .mockResolvedValueOnce([   // _prisma_migrations
          { migration_name: "20260914_baseline", finished_at: new Date() },
        ]);

      const health = await getArchiveHealth();

      expect(health.database.status).toBe("healthy");
      expect(health.database.totalCharacters).toBe(355);
      expect(health.database.totalVersions).toBe(355);
      expect(health.artwork.totalAssets).toBe(350);
      expect(health.artwork.missingCurrentArtwork).toHaveLength(0);
      expect(health.artwork.brokenHistoricalArtwork).toHaveLength(0);
      expect(health.artwork.orphanArtwork).toHaveLength(0);
      expect(health.migrations.latestMigration).toBe("20260914_baseline");
      expect(health.migrations.appliedCount).toBe(1);
      expect(health.operational.sessionCount).toBe(2);
    });

    it("marks database status as unhealthy if missing current artwork exists", async () => {
      mockPrisma.character.count.mockResolvedValue(10);
      mockPrisma.characterSource.count.mockResolvedValue(10);
      mockPrisma.characterVersion.count.mockResolvedValue(10);
      mockPrisma.greeting.count.mockResolvedValue(10);
      mockPrisma.tag.count.mockResolvedValue(10);
      mockPrisma.lorebook.count.mockResolvedValue(0);
      mockPrisma.artworkAsset.aggregate.mockResolvedValue({
        _count: { sha256: 9 },
        _sum: { byteLength: 1000 },
      });
      mockPrisma.userSession.count.mockResolvedValue(0);
      mockPrisma.notification.count.mockResolvedValue(0);

      mockPrisma.$queryRaw
        .mockResolvedValueOnce([{ artworkSha256: "missing-sha" }]) // missingCurrentRows
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const health = await getArchiveHealth();
      expect(health.database.status).toBe("unhealthy");
      expect(health.artwork.missingCurrentArtwork).toContain("missing-sha");
    });
  });

  describe("validateBackupManifest", () => {
    const validManifest: BackupManifest = {
      format: "character-archive-backup",
      formatVersion: 1,
      createdAt: "2026-09-15T00:00:00.000Z",
      applicationVersion: "0.1.0",
      gitCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
      environment: "test",
      tooling: {
        pgDumpVersion: "pg_dump (PostgreSQL) 17.11",
        nodeVersion: "v22.0.0",
      },
      schema: {
        generator: "prisma",
        lastMigration: "20260914_version_baseline",
        migrationCount: 15,
        migrations: ["20260914_version_baseline"],
      },
      database: {
        format: "postgres-custom",
        fileName: "database.dump",
        sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bytes: 1024,
        tableCounts: { Character: 355 },
        excludedTableData: ["UserSession"],
      },
      artwork: {
        objectCount: 1,
        totalBytes: 512,
        objects: [
          {
            sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            storageKey: "artwork/sha256/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
            fileName: "artwork/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
            bytes: 512,
            mime: "image/png",
          },
        ],
      },
      packageDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    };

    it("accepts a valid manifest structure", () => {
      const res = validateBackupManifest(validManifest);
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
      expect(res.summary?.formatVersion).toBe(1);
    });

    it("rejects non-object or null manifests", () => {
      expect(validateBackupManifest(null).valid).toBe(false);
      expect(validateBackupManifest("string").valid).toBe(false);
    });

    it("rejects unknown format or formatVersion", () => {
      const invalid = { ...validManifest, formatVersion: 2 as unknown as 1 };
      const res = validateBackupManifest(invalid);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("formatVersion"))).toBe(true);
    });

    it("rejects invalid database sha256 or negative bytes", () => {
      const invalid = {
        ...validManifest,
        database: { ...validManifest.database, sha256: "invalid-hash", bytes: -5 },
      };
      const res = validateBackupManifest(invalid);
      expect(res.valid).toBe(false);
      expect(res.errors.length).toBeGreaterThanOrEqual(2);
    });

    it("rejects artwork objectCount mismatch", () => {
      const invalid = {
        ...validManifest,
        artwork: { ...validManifest.artwork, objectCount: 99 },
      };
      const res = validateBackupManifest(invalid);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("object count mismatch"))).toBe(true);
    });

    it("rejects artwork totalBytes sum mismatch", () => {
      const invalid = {
        ...validManifest,
        artwork: { ...validManifest.artwork, totalBytes: 9999 },
      };
      const res = validateBackupManifest(invalid);
      expect(res.valid).toBe(false);
      expect(res.errors.some((e) => e.includes("totalBytes mismatch"))).toBe(true);
    });
  });

  describe("verifyBackupDirectory (tamper detection)", () => {
    const testDir = path.resolve(process.cwd(), "temp-test-backup-dir");

    async function setupTestPackage() {
      await rm(testDir, { recursive: true, force: true }).catch(() => {});
      await mkdir(path.join(testDir, "artwork"), { recursive: true });

      const dbContent = Buffer.from("test postgres dump bytes");
      const dbSha256 = createHash("sha256").update(dbContent).digest("hex");
      await writeFile(path.join(testDir, "database.dump"), dbContent);

      const artContent = Buffer.from("test png artwork content");
      const artSha256 = createHash("sha256").update(artContent).digest("hex");
      await writeFile(path.join(testDir, "artwork", `${artSha256}.png`), artContent);

      const packageDigest = computePackageDigest([
        { relativePath: "database.dump", sha256: dbSha256 },
        { relativePath: `artwork/${artSha256}.png`, sha256: artSha256 },
      ]);

      const manifest: BackupManifest = {
        format: "character-archive-backup",
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        applicationVersion: "0.1.0",
        gitCommitSha: "1234567890abcdef1234567890abcdef12345678",
        environment: "test",
        tooling: {
          pgDumpVersion: "pg_dump 17.11",
          nodeVersion: "v22.0.0",
        },
        schema: {
          generator: "prisma",
          lastMigration: "20260914_baseline",
          migrationCount: 1,
          migrations: ["20260914_baseline"],
        },
        database: {
          format: "postgres-custom",
          fileName: "database.dump",
          sha256: dbSha256,
          bytes: dbContent.length,
          tableCounts: { Character: 1 },
          excludedTableData: ["UserSession"],
        },
        artwork: {
          objectCount: 1,
          totalBytes: artContent.length,
          objects: [
            {
              sha256: artSha256,
              storageKey: `artwork/sha256/${artSha256}.png`,
              fileName: `artwork/${artSha256}.png`,
              bytes: artContent.length,
              mime: "image/png",
            },
          ],
        },
        packageDigest,
      };

      await writeFile(path.join(testDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
      return { artSha256, dbSha256 };
    }

    it("verifies a valid intact backup package", async () => {
      try {
        await setupTestPackage();
        const res = await verifyBackupDirectory(testDir);
        expect(res.valid).toBe(true);
        expect(res.errors).toHaveLength(0);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("fails when the database dump has been tampered with", async () => {
      try {
        await setupTestPackage();
        await writeFile(path.join(testDir, "database.dump"), Buffer.from("TAMPERED DATABASE BYTES"));
        const res = await verifyBackupDirectory(testDir);
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("Database dump SHA-256 mismatch"))).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("fails when an artwork file has been modified", async () => {
      try {
        const { artSha256 } = await setupTestPackage();
        await writeFile(path.join(testDir, "artwork", `${artSha256}.png`), Buffer.from("TAMPERED PNG BYTES"));
        const res = await verifyBackupDirectory(testDir);
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("content SHA-256 mismatch"))).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("fails when an expected artwork file is missing", async () => {
      try {
        const { artSha256 } = await setupTestPackage();
        await rm(path.join(testDir, "artwork", `${artSha256}.png`));
        const res = await verifyBackupDirectory(testDir);
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("Missing artwork file"))).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("fails when an unexpected rogue file exists in artwork directory", async () => {
      try {
        await setupTestPackage();
        await writeFile(path.join(testDir, "artwork", "rogue-file.png"), Buffer.from("rogue"));
        const res = await verifyBackupDirectory(testDir);
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("Unexpected extra file found"))).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });

    it("fails when the package digest has been modified", async () => {
      try {
        await setupTestPackage();
        const manifestPath = path.join(testDir, "manifest.json");
        const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8"));
        manifest.packageDigest = "0000000000000000000000000000000000000000000000000000000000000000";
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

        const res = await verifyBackupDirectory(testDir);
        expect(res.valid).toBe(false);
        expect(res.errors.some((e) => e.includes("Package digest mismatch"))).toBe(true);
      } finally {
        await rm(testDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
