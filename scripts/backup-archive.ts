import "./env-bootstrap";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_SUPABASE_ARTWORK_BUCKET,
  readSupabaseCredentials,
} from "../src/lib/artwork/supabase-store";
import { computePackageDigest, verifyBackupDirectory } from "../src/lib/backup/service";
import type { BackupArtworkObject, BackupManifest } from "../src/lib/backup/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function cleanDatabaseUrlForPgCli(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.delete("uselibpqcompat");
    // Supabase recommends session pooler (port 6543) for tools like pg_dump and pg_restore
    if (parsed.port === "5432" && parsed.hostname.includes("pooler.supabase.com")) {
      parsed.port = "6543";
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function resolvePgTool(toolName: string, envVar: string): string {
  if (process.env[envVar] && fs.existsSync(process.env[envVar]!)) {
    return process.env[envVar]!;
  }
  const localAppData = process.env.LOCALAPPDATA || "";
  const localPg = path.join(localAppData, "Programs", "pgsql", "pgsql", "bin", `${toolName}.exe`);
  if (fs.existsSync(localPg)) {
    return localPg;
  }
  return toolName;
}

export async function checkPgVersion(toolPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(toolPath, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`${toolPath} failed with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

async function getGitCommitSha(): Promise<string> {
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    return process.env.VERCEL_GIT_COMMIT_SHA;
  }
  return new Promise((resolve) => {
    const child = spawn("git", ["rev-parse", "HEAD"], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
      } else {
        resolve("unknown");
      }
    });
    child.on("error", () => resolve("unknown"));
  });
}

async function runBackup() {
  const startTime = Date.now();
  console.log("===============================================================");
  console.log("       CHARACTER ARCHIVE HYBRID BACKUP GENERATOR");
  console.log("===============================================================\n");

  // 1. Preflight tool checks
  const pgDumpBin = resolvePgTool("pg_dump", "PG_DUMP_PATH");
  let pgDumpVersion = "";
  try {
    pgDumpVersion = await checkPgVersion(pgDumpBin);
    console.log(`[1/7] Verified PostgreSQL Tool: ${pgDumpVersion}`);
  } catch (err) {
    console.error("❌ Preflight check failed: pg_dump client binary not found or failed.");
    console.error("   Please install PostgreSQL client tools or set PG_DUMP_PATH.");
    console.error(`   Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 2. Preflight database checks
  const databaseUrl = process.env.DATABASE_URL!;
  console.log("[2/7] Querying catalog invariants and migration state from database...");
  const { prisma } = await import("../lib/prisma");

  try {
    const [
      totalCharacters,
      totalSources,
      totalVersions,
      totalGreetings,
      totalTags,
      totalCharacterTags,
      totalLorebooks,
      totalArtworks,
      totalFavorites,
      totalCartItems,
      totalCollections,
      totalCollectionItems,
      totalViews,
      totalUsers,
      totalBlockRules,
      totalBlockedCreators,
      totalNotifications,
      migrationsRows,
    ] = await Promise.all([
      prisma.character.count(),
      prisma.characterSource.count(),
      prisma.characterVersion.count(),
      prisma.greeting.count(),
      prisma.tag.count(),
      prisma.characterTag.count(),
      prisma.lorebook.count(),
      prisma.artworkAsset.count(),
      prisma.characterFavorite.count(),
      prisma.characterCartItem.count(),
      prisma.characterCollection.count(),
      prisma.characterCollectionItem.count(),
      prisma.characterView.count(),
      prisma.user.count(),
      prisma.blockRule.count(),
      prisma.blockedCreator.count(),
      prisma.notification.count(),
      prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
        SELECT migration_name, finished_at
        FROM _prisma_migrations
        WHERE rolled_back_at IS NULL
        ORDER BY finished_at DESC
      `.catch(() => []),
    ]);

    const appliedMigrations = (migrationsRows as Array<{ migration_name: string; finished_at: Date | null }>)
      .filter((m) => m.finished_at != null)
      .map((m) => m.migration_name);
    const latestMigration = appliedMigrations.length > 0 ? appliedMigrations[0] : "unknown";

    const tableCounts: Record<string, number> = {
      Character: totalCharacters,
      CharacterSource: totalSources,
      CharacterVersion: totalVersions,
      Greeting: totalGreetings,
      Tag: totalTags,
      CharacterTag: totalCharacterTags,
      Lorebook: totalLorebooks,
      ArtworkAsset: totalArtworks,
      CharacterFavorite: totalFavorites,
      CharacterCartItem: totalCartItems,
      CharacterCollection: totalCollections,
      CharacterCollectionItem: totalCollectionItems,
      CharacterView: totalViews,
      User: totalUsers,
      BlockRule: totalBlockRules,
      BlockedCreator: totalBlockedCreators,
      Notification: totalNotifications,
    };

    console.log(`      Found ${totalCharacters} Characters, ${totalVersions} Versions, ${totalArtworks} Artworks`);
    console.log(`      Latest Prisma Migration: ${latestMigration} (${appliedMigrations.length} applied)`);

    // Read app version
    let appVersion = "1.0.0";
    try {
      const pkg = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8"));
      if (pkg.version) appVersion = pkg.version;
    } catch {}

    const gitCommitSha = await getGitCommitSha();

    // 3. Staging directory setup
    const nowStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const backupsRoot = path.join(process.cwd(), "backups");
    await mkdir(backupsRoot, { recursive: true });

    const stagingDir = path.join(backupsRoot, `.incomplete-backup-${nowStr}`);
    const finalDir = path.join(backupsRoot, `character-archive-backup-${nowStr}`);
    const artworkStagingDir = path.join(stagingDir, "artwork");

    await mkdir(artworkStagingDir, { recursive: true });
    console.log(`[3/7] Created staging workspace: ${stagingDir}`);

    try {
      // 4. Authoritative PostgreSQL logical dump
      const dumpFileName = "database.dump";
      const dumpFilePath = path.join(stagingDir, dumpFileName);

      console.log("[4/7] Generating PostgreSQL custom dump via pg_dump (-Fc, ephemeral data excluded)...");
      const pgArgs = [
        "-v",
        "-Fc",
        "--no-owner",
        "--no-privileges",
        "--schema=public",
        '--exclude-table-data="UserSession"',
        '--exclude-table-data="ImportPreviewJob"',
        '--exclude-table-data="BridgePairing"',
        '--exclude-table-data="BridgeSession"',
        '--exclude-table-data="BridgeJob"',
        "-f",
        dumpFilePath,
        cleanDatabaseUrlForPgCli(databaseUrl),
      ];

      async function execPgDump() {
        return new Promise<void>((resolve, reject) => {
          const child = spawn(pgDumpBin, pgArgs, { stdio: ["ignore", "ignore", "pipe"] });
          let stderr = "";
          child.stderr.on("data", (d) => {
            const str = d.toString();
            stderr += str;
            const lines = str.split(/\r?\n/);
            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("pg_dump: dumping contents of table") || trimmed.startsWith("pg_dump: saving database definition")) {
                console.log(`      ${trimmed}`);
              }
            }
          });
          child.on("close", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`pg_dump failed with exit code ${code}: ${stderr}`));
            }
          });
          child.on("error", (err) => reject(err));
        });
      }

      try {
        await execPgDump();
      } catch {
        console.warn("⚠️ Initial pg_dump stream interrupted. Retrying once...");
        await execPgDump();
      }

      const dumpStat = fs.statSync(dumpFilePath);
      const dumpBytes = await readFile(dumpFilePath);
      const dbSha256 = createHash("sha256").update(dumpBytes).digest("hex");
      console.log(`      PostgreSQL dump completed: ${formatBytes(dumpStat.size)} (${dbSha256.slice(0, 16)}...)`);

      // 5. Download and stream artwork
      console.log(`[5/7] Downloading and verifying ${totalArtworks} artwork objects...`);
      const assets = await prisma.artworkAsset.findMany({
        select: {
          sha256: true,
          storageKey: true,
          byteLength: true,
          mediaType: true,
          width: true,
          height: true,
        },
        orderBy: { sha256: "asc" },
      });

      let creds: { url: string; serviceRoleKey: string } | null = null;
      try {
        creds = readSupabaseCredentials();
      } catch {
        // Local fallback
      }

      const localBlobsDir =
        process.env.ARTWORK_BLOBS_DIR ||
        "C:\\Users\\Karl\\Downloads\\character_archive_artwork_blobs_350";
      const bucket = process.env.SUPABASE_ARTWORK_BUCKET?.trim() || DEFAULT_SUPABASE_ARTWORK_BUCKET;
      const artworkObjects: BackupArtworkObject[] = [];
      let totalArtworkBytes = 0;

      const CONCURRENCY = 8;
      let completedCount = 0;

      for (let i = 0; i < assets.length; i += CONCURRENCY) {
        const batch = assets.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (asset) => {
            let buf: Buffer | null = null;
            const localBlobPath = path.join(localBlobsDir, `${asset.sha256}.png`);
            if (fs.existsSync(localBlobPath)) {
              buf = await readFile(localBlobPath);
            } else if (creds) {
              try {
                const url = `${creds.url}/storage/v1/object/authenticated/${bucket}/${asset.storageKey}`;
                const res = await fetch(url, {
                  headers: {
                    Authorization: `Bearer ${creds.serviceRoleKey}`,
                    apikey: creds.serviceRoleKey,
                  },
                  cache: "no-store",
                });
                if (res.ok) {
                  buf = Buffer.from(await res.arrayBuffer());
                }
              } catch {}
            }

            if (!buf) {
              throw new Error(`Artwork object ${asset.sha256} could not be retrieved from storage or local repository.`);
            }

            const downloadedSha = createHash("sha256").update(buf).digest("hex");

            if (downloadedSha.toLowerCase() !== asset.sha256.toLowerCase()) {
              throw new Error(
                `Integrity corruption detected for artwork ${asset.sha256}: computed SHA ${downloadedSha} does not match database record.`
              );
            }

            const targetFileName = `${asset.sha256}.png`;
            const targetRelPath = `artwork/${targetFileName}`;
            const targetFullPath = path.join(artworkStagingDir, targetFileName);

            await writeFile(targetFullPath, buf);

            artworkObjects.push({
              sha256: asset.sha256,
              storageKey: asset.storageKey,
              fileName: targetRelPath,
              bytes: buf.length,
              mime: asset.mediaType,
              width: asset.width ?? undefined,
              height: asset.height ?? undefined,
            });

            totalArtworkBytes += buf.length;
            completedCount++;

            if (completedCount % 50 === 0 || completedCount === assets.length) {
              process.stdout.write(`      Verified & archived ${completedCount}/${assets.length} artwork files...\r`);
            }
          })
        );
      }
      console.log(`\n      Artwork backup complete: ${artworkObjects.length} files (${formatBytes(totalArtworkBytes)})`);

      // 6. Manifest construction & package digest
      console.log("[6/7] Computing deterministic package digest and writing manifest.json...");
      artworkObjects.sort((a, b) => a.fileName.localeCompare(b.fileName));

      const digestParts = [
        { relativePath: dumpFileName, sha256: dbSha256 },
        ...artworkObjects.map((obj) => ({ relativePath: obj.fileName, sha256: obj.sha256 })),
      ];
      const packageDigest = computePackageDigest(digestParts);

      const manifest: BackupManifest = {
        format: "character-archive-backup",
        formatVersion: 1,
        createdAt: new Date().toISOString(),
        applicationVersion: appVersion,
        gitCommitSha,
        environment: process.env.NODE_ENV || "production",
        tooling: {
          pgDumpVersion,
          nodeVersion: process.version,
        },
        schema: {
          generator: "prisma",
          lastMigration: latestMigration,
          migrationCount: appliedMigrations.length,
          migrations: appliedMigrations,
        },
        database: {
          format: "postgres-custom",
          fileName: dumpFileName,
          sha256: dbSha256,
          bytes: dumpStat.size,
          tableCounts,
          excludedTableData: [
            "UserSession",
            "ImportPreviewJob",
            "BridgePairing",
            "BridgeSession",
            "BridgeJob",
          ],
        },
        artwork: {
          objectCount: artworkObjects.length,
          totalBytes: totalArtworkBytes,
          objects: artworkObjects,
        },
        packageDigest,
      };

      const manifestPath = path.join(stagingDir, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

      // 7. Offline package validation
      console.log("[7/7] Running offline validation on staging package...");
      const validation = await verifyBackupDirectory(stagingDir);
      if (!validation.valid) {
        console.error("❌ Staging package validation failed:");
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        throw new Error("Staging package verification failed.");
      }

      // Atomic rename to final directory
      await rename(stagingDir, finalDir);

      // Apply restrictive permissions (best-effort)
      try {
        fs.chmodSync(finalDir, 0o700);
        fs.chmodSync(path.join(finalDir, "manifest.json"), 0o600);
        fs.chmodSync(path.join(finalDir, dumpFileName), 0o600);
        const artFiles = await readdir(path.join(finalDir, "artwork"));
        for (const f of artFiles) {
          fs.chmodSync(path.join(finalDir, "artwork", f), 0o600);
        }
      } catch {
        // Best effort on Windows
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log("\n===============================================================");
      console.log("          BACKUP GENERATED AND VERIFIED SUCCESSFULLY");
      console.log("===============================================================");
      console.log(`Directory:      ${finalDir}`);
      console.log(`Duration:       ${elapsed}s`);
      console.log(`Format:         character-archive-backup (v${manifest.formatVersion})`);
      console.log(`Database Dump:  ${manifest.database.fileName} (${formatBytes(manifest.database.bytes)})`);
      console.log(`Artwork Count:  ${manifest.artwork.objectCount} objects (${formatBytes(manifest.artwork.totalBytes)})`);
      console.log(`Total Size:     ${formatBytes(manifest.database.bytes + manifest.artwork.totalBytes)}`);
      console.log(`Package Digest: ${packageDigest}`);
      console.log("===============================================================\n");
    } catch (err) {
      console.error("\n❌ Backup failed with error:", err);
      console.log("Cleaning up temporary staging directory...");
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backup-archive.ts")) {
  runBackup().catch((err) => {
    console.error("Fatal backup error:", err);
    process.exit(1);
  });
}
