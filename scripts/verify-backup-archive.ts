import "./env-bootstrap";
import path from "node:path";
import { verifyBackupDirectory } from "../src/lib/backup/service";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

async function main() {
  const targetDir = process.argv[2];

  if (!targetDir) {
    console.error("Error: Missing backup directory path.\n");
    console.error("Usage:");
    console.error("  npx tsx scripts/verify-backup-archive.ts <path-to-backup-dir>\n");
    process.exit(1);
  }

  const resolvedDir = path.resolve(process.cwd(), targetDir);
  console.log("===============================================================");
  console.log("       CHARACTER ARCHIVE OFFLINE PACKAGE VERIFICATION");
  console.log("===============================================================");
  console.log(`Target: ${resolvedDir}\n`);

  const result = await verifyBackupDirectory(resolvedDir);

  if (!result.valid) {
    console.error("❌ PACKAGE VERIFICATION FAILED\n");
    console.error(`Encountered ${result.errors.length} error(s):`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    if (result.warnings.length > 0) {
      console.warn(`\nWarnings (${result.warnings.length}):`);
      for (const warn of result.warnings) {
        console.warn(`  - ${warn}`);
      }
    }
    process.exit(1);
  }

  console.log("✅ PACKAGE INTEGRITY VERIFIED (ALL CHECKS PASSED)\n");
  if (result.summary) {
    console.log("Package Summary:");
    console.log(`  Format Version:    ${result.summary.formatVersion}`);
    console.log(`  Created At:        ${result.summary.createdAt}`);
    console.log(`  Git Commit:        ${result.summary.gitCommitSha}`);
    console.log(`  pg_dump Tool:      ${result.summary.pgDumpVersion}`);
    console.log(`  Last Migration:    ${result.summary.lastMigration}`);
    console.log(`  PostgreSQL Dump:   ${result.summary.dbSha256} (${formatBytes(result.summary.dbBytes)})`);
    console.log(`  Artwork Objects:   ${result.summary.artworkObjectCount} files (${formatBytes(result.summary.totalArtworkBytes)})`);
    console.log(`  Package Digest:    ${result.summary.packageDigest}\n`);

    console.log("Table Record Counts in Backup:");
    for (const [table, count] of Object.entries(result.summary.tables)) {
      console.log(`  - ${table.padEnd(24)} ${count.toLocaleString()}`);
    }
  }

  if (result.warnings.length > 0) {
    console.warn(`\nWarnings (${result.warnings.length}):`);
    for (const warn of result.warnings) {
      console.warn(`  - ${warn}`);
    }
  }
}

main().catch((err) => {
  console.error("Unexpected verification error:", err);
  process.exit(1);
});
