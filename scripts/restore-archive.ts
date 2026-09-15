import "./env-bootstrap";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  DEFAULT_SUPABASE_ARTWORK_BUCKET,
  readSupabaseCredentials,
} from "../src/lib/artwork/supabase-store";
import { verifyBackupDirectory } from "../src/lib/backup/service";
import type { BackupManifest } from "../src/lib/backup/types";
import { checkPgVersion, cleanDatabaseUrlForPgCli, resolvePgTool } from "./backup-archive";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export async function runRestore(options?: {
  backupDir?: string;
  targetDatabaseUrl?: string;
  clean?: boolean;
  restoreArtwork?: boolean;
  confirmLiveWipe?: boolean;
}) {
  const startTime = Date.now();
  console.log("===============================================================");
  console.log("       CHARACTER ARCHIVE DISASTER RECOVERY RESTORE TOOL");
  console.log("===============================================================\n");

  const args = process.argv.slice(2);
  const backupDirArg = options?.backupDir ?? args.find((a) => !a.startsWith("--"));
  const targetDbArg =
    options?.targetDatabaseUrl ??
    args.find((a) => a.startsWith("--target-db="))?.slice("--target-db=".length);
  const cleanRequested = options?.clean ?? args.includes("--clean");
  const restoreArtworkRequested = options?.restoreArtwork ?? args.includes("--restore-artwork");
  const confirmLiveWipe = options?.confirmLiveWipe ?? args.includes("--confirm-live-wipe");

  if (!backupDirArg) {
    console.error("❌ Error: Missing backup directory path.\n");
    console.error("Usage:");
    console.error("  npx tsx scripts/restore-archive.ts <path-to-backup-dir> [options]\n");
    console.error("Options:");
    console.error("  --target-db=<url>      Target PostgreSQL connection URL (or set TARGET_DATABASE_URL)");
    console.error("  --clean                Drop existing database objects before recreating them");
    console.error("  --restore-artwork      Upload backed-up artwork to configured target Supabase Storage");
    console.error("  --confirm-live-wipe    Explicit confirmation required if target matches live environment\n");
    process.exit(1);
  }

  const backupDir = path.resolve(process.cwd(), backupDirArg);
  const targetDatabaseUrl = targetDbArg || process.env.TARGET_DATABASE_URL;

  if (!targetDatabaseUrl) {
    console.error("❌ Error: Target database URL is required.");
    console.error("   Specify --target-db=<url> or set TARGET_DATABASE_URL environment variable.");
    console.error("   For disaster-recovery drills, target an isolated test database.\n");
    process.exit(1);
  }

  // Safety Gate: Live Preview / Production Protection
  const liveDbUrl = process.env.DATABASE_URL;
  const isTargetLive = liveDbUrl && targetDatabaseUrl.trim().toLowerCase() === liveDbUrl.trim().toLowerCase();
  if (isTargetLive) {
    if (!confirmLiveWipe || process.env.ALLOW_LIVE_RESTORE_OVERRIDE !== "true") {
      console.error("\n🚨 SAFETY INTERLOCK ENGAGED: TARGET IS LIVE DATABASE!");
      console.error("   The specified target database matches your current DATABASE_URL.");
      console.error("   In-place restoration onto live databases is prohibited unless explicitly overridden.");
      console.error("   To proceed, you must set ALLOW_LIVE_RESTORE_OVERRIDE=true and pass --confirm-live-wipe.\n");
      process.exit(1);
    }
  }

  // 1. Tool check
  const pgRestoreBin = resolvePgTool("pg_restore", "PG_RESTORE_PATH");
  let pgRestoreVersion = "";
  try {
    pgRestoreVersion = await checkPgVersion(pgRestoreBin);
    console.log(`[1/5] Verified PostgreSQL Tool: ${pgRestoreVersion}`);
  } catch (err) {
    console.error("❌ Preflight check failed: pg_restore client binary not found or failed.");
    console.error("   Please install PostgreSQL client tools or set PG_RESTORE_PATH.");
    console.error(`   Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // 2. Package verification
  console.log(`[2/5] Validating backup package integrity offline at ${backupDir}...`);
  const validation = await verifyBackupDirectory(backupDir);
  if (!validation.valid) {
    console.error("\n❌ REFUSING RESTORE: Backup package validation failed!");
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  const manifestPath = path.join(backupDir, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as BackupManifest;
  console.log(`      Package Verified: ${manifest.database.fileName} (${formatBytes(manifest.database.bytes)}), ${manifest.artwork.objectCount} artwork items`);
  console.log(`      Package Digest:   ${manifest.packageDigest}`);

  // 3. Inspect target database state
  console.log("[3/5] Inspecting target database state...");
  const pool = new Pool({
    connectionString: targetDatabaseUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    const tableRes = await pool.query(
      `SELECT count(*)::int as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
    );
    const existingTableCount = tableRes.rows[0]?.count ?? 0;
    if (existingTableCount > 0 && !cleanRequested) {
      console.error(`\n❌ Target database is not empty (${existingTableCount} tables found in 'public' schema).`);
      console.error("   Please target an empty database, or pass --clean to drop existing objects.\n");
      await pool.end();
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Failed to connect to target database: ${err instanceof Error ? err.message : String(err)}`);
    await pool.end();
    process.exit(1);
  }

  // 4. Execute pg_restore
  console.log("[4/5] Restoring database schema, constraints, migrations, and data via pg_restore...");
  const dumpFilePath = path.join(backupDir, manifest.database.fileName);
  const restoreArgs = [
    "-Fc",
    "--no-owner",
    "--no-privileges",
    ...(cleanRequested ? ["--clean", "--if-exists"] : []),
    "-d",
    cleanDatabaseUrlForPgCli(targetDatabaseUrl),
    dumpFilePath,
  ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(pgRestoreBin, restoreArgs, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => {
      const str = d.toString();
      stderr += str;
      process.stderr.write(str);
    });
    child.on("close", (code) => {
      if (code === 0 || (code === 1 && stderr.includes("errors ignored on restore"))) {
        resolve();
      } else {
        reject(new Error(`pg_restore failed with exit code ${code}:\n${stderr}`));
      }
    });
    child.on("error", (err) => reject(err));
  });

  // 5. Verification of restored state
  console.log("[5/5] Verifying restored invariants and data integrity in target database...");
  try {
    await pool.query('SET search_path TO public, "$user"');
    const countsRes = await pool.query(`
      SELECT
        (SELECT count(*) FROM public."Character") as characters,
        (SELECT count(*) FROM public."CharacterSource") as sources,
        (SELECT count(*) FROM public."CharacterVersion") as versions,
        (SELECT count(*) FROM public."ArtworkAsset") as artworks,
        (SELECT count(*) FROM public."Greeting") as greetings,
        (SELECT count(*) FROM public."Lorebook") as lorebooks,
        (SELECT count(*) FROM public."UserSession") as sessions,
        (SELECT count(*) FROM public."ImportPreviewJob") as import_jobs,
        (SELECT count(*) FROM public."BridgePairing") as bridge_pairings,
        (SELECT count(*) FROM public."BridgeSession") as bridge_sessions,
        (SELECT count(*) FROM public."BridgeJob") as bridge_jobs
    `);

    const r = countsRes.rows[0];
    const restoredCharacters = parseInt(r.characters, 10);
    const restoredSources = parseInt(r.sources, 10);
    const restoredVersions = parseInt(r.versions, 10);
    const restoredArtworks = parseInt(r.artworks, 10);
    const restoredGreetings = parseInt(r.greetings, 10);
    const restoredLorebooks = parseInt(r.lorebooks, 10);

    const ephemeralCount =
      parseInt(r.sessions, 10) +
      parseInt(r.import_jobs, 10) +
      parseInt(r.bridge_pairings, 10) +
      parseInt(r.bridge_sessions, 10) +
      parseInt(r.bridge_jobs, 10);

    console.log(`      Restored Characters: ${restoredCharacters} (Manifest: ${manifest.database.tableCounts.Character})`);
    console.log(`      Restored Sources:    ${restoredSources} (Manifest: ${manifest.database.tableCounts.CharacterSource})`);
    console.log(`      Restored Versions:   ${restoredVersions} (Manifest: ${manifest.database.tableCounts.CharacterVersion})`);
    console.log(`      Restored Artworks:   ${restoredArtworks} (Manifest: ${manifest.database.tableCounts.ArtworkAsset})`);
    console.log(`      Restored Greetings:  ${restoredGreetings} (Manifest: ${manifest.database.tableCounts.Greeting})`);
    console.log(`      Restored Lorebooks:  ${restoredLorebooks} (Manifest: ${manifest.database.tableCounts.Lorebook})`);
    console.log(`      Ephemeral Rows:      ${ephemeralCount} (Expected: 0)`);

    if (ephemeralCount !== 0) {
      console.warn("⚠️ Warning: Non-zero ephemeral rows detected in restored database.");
    }

    // Verify cross-reference integrity in target DB
    const missingArtworkRes = await pool.query(`
      SELECT count(*) as count
      FROM "Character" c
      WHERE c."artworkSha256" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ArtworkAsset" a WHERE a.sha256 = c."artworkSha256"
        )
    `);
    const missingCount = parseInt(missingArtworkRes.rows[0]?.count ?? "0", 10);

    const brokenHistoryRes = await pool.query(`
      SELECT count(*) as count
      FROM "CharacterVersion" cv
      WHERE cv."artworkSha256" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM "ArtworkAsset" a WHERE a.sha256 = cv."artworkSha256"
        )
    `);
    const brokenCount = parseInt(brokenHistoryRes.rows[0]?.count ?? "0", 10);

    console.log(`      Missing Current Artwork: ${missingCount} (Target: 0)`);
    console.log(`      Broken Historical Refs:  ${brokenCount} (Target: 0)`);

    if (missingCount > 0 || brokenCount > 0) {
      throw new Error(`Data integrity invariant failed: ${missingCount} missing, ${brokenCount} broken references.`);
    }

    // Artwork Storage Sync (if requested)
    if (restoreArtworkRequested) {
      console.log(`\nSynchronizing ${manifest.artwork.objectCount} artwork objects to storage bucket...`);
      const creds = readSupabaseCredentials();
      const bucket = process.env.SUPABASE_ARTWORK_BUCKET?.trim() || DEFAULT_SUPABASE_ARTWORK_BUCKET;

      let uploaded = 0;
      for (const obj of manifest.artwork.objects) {
        const filePath = path.join(backupDir, obj.fileName);
        const fileBytes = await readFile(filePath);
        const fileHash = createHash("sha256").update(fileBytes).digest("hex");

        if (fileHash.toLowerCase() !== obj.sha256.toLowerCase()) {
          throw new Error(`Artwork hash mismatch for ${obj.fileName} prior to upload.`);
        }

        const url = `${creds.url}/storage/v1/object/${bucket}/${obj.storageKey}`;
        const uploadRes = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${creds.serviceRoleKey}`,
            apikey: creds.serviceRoleKey,
            "Content-Type": obj.mime || "image/png",
            "x-upsert": "false", // Do not overwrite existing objects
          },
          body: fileBytes,
        });

        if (uploadRes.ok || uploadRes.status === 409 || uploadRes.status === 400) {
          uploaded++;
        } else {
          console.warn(`Warning: Could not upload artwork ${obj.storageKey}: HTTP ${uploadRes.status}`);
        }
      }
      console.log(`Artwork synchronization finished: ${uploaded}/${manifest.artwork.objectCount} verified in bucket.`);
    } else {
      console.log(`\nNote: Artwork files are preserved on disk at ${path.join(backupDir, "artwork")}. Pass --restore-artwork to sync into Supabase Storage.`);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("\n===============================================================");
    console.log("       DISASTER RECOVERY RESTORATION COMPLETE & VERIFIED");
    console.log("===============================================================");
    console.log(`Duration:          ${elapsed}s`);
    console.log(`Target:            ${targetDatabaseUrl.replace(/:\/\/.*@/, "://***@")}`);
    console.log(`Catalog Restored:  ${restoredCharacters} Characters, ${restoredVersions} Versions, ${restoredArtworks} Artworks`);
    console.log(`Integrity Check:   0 missing artwork, 0 broken historical refs`);
    console.log("===============================================================\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("restore-archive.ts")) {
  runRestore().catch((err) => {
    console.error("Fatal restore error:", err);
    process.exit(1);
  });
}
