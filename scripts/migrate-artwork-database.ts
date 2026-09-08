import * as fs from "fs";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres.ofdkiwwggzojofbxpxfr:chikpeas%40%23.@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true";
const MANIFEST_PATH = "C:\\Users\\Karl\\Downloads\\character_archive_artwork_manifest.json";

async function main() {
  console.log("===============================================================");
  console.log("     ATOMIC DATABASE MIGRATION: OLD-SHA -> OPTIMIZED-SHA");
  console.log("===============================================================");

  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`Manifest missing at ${MANIFEST_PATH}`);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

  const pool = new Pool({ connectionString: DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log("Beginning atomic transaction...");
    await client.query("BEGIN");

    // 1. Temporary mapping table
    await client.query(`
      CREATE TEMP TABLE artwork_migration_map (
        old_sha VARCHAR(64) PRIMARY KEY,
        new_sha VARCHAR(64) NOT NULL,
        new_bytes INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL
      ) ON COMMIT DROP;
    `);

    // 2. Populate mapping
    for (const item of manifest.mapping) {
      const [w, h] = item.dimensions.split("x").map(Number);
      await client.query(
        `INSERT INTO artwork_migration_map (old_sha, new_sha, new_bytes, width, height)
         VALUES ($1, $2, $3, $4, $5)`,
        [item.originalSha256, item.optimizedSha256, item.optimizedBytes, w, h]
      );
    }
    console.log(`Loaded ${manifest.mapping.length} mappings into temp table.`);

    // 3. Insert new ArtworkAsset rows (deduplicated)
    const insertRes = await client.query(`
      INSERT INTO "ArtworkAsset" (sha256, "mediaType", "byteLength", width, height, "storageKey", "createdAt")
      SELECT DISTINCT ON (m.new_sha)
        m.new_sha,
        'image/png',
        m.new_bytes,
        m.width,
        m.height,
        'artwork/sha256/' || m.new_sha || '.png',
        a."createdAt"
      FROM artwork_migration_map m
      JOIN "ArtworkAsset" a ON a.sha256 = m.old_sha
      ORDER BY m.new_sha, a."createdAt" ASC
      ON CONFLICT (sha256) DO NOTHING;
    `);
    console.log(`Inserted ${insertRes.rowCount} unique rows into ArtworkAsset.`);

    // 4. Repoint Character.artworkSha256
    const updateRes = await client.query(`
      UPDATE "Character" c
      SET "artworkSha256" = m.new_sha
      FROM artwork_migration_map m
      WHERE c."artworkSha256" = m.old_sha;
    `);
    console.log(`Updated ${updateRes.rowCount} Character records with new artwork hashes.`);

    // 5. Delete deprecated ArtworkAsset rows
    const deleteRes = await client.query(`
      DELETE FROM "ArtworkAsset" a
      USING artwork_migration_map m
      WHERE a.sha256 = m.old_sha;
    `);
    console.log(`Deleted ${deleteRes.rowCount} deprecated ArtworkAsset rows.`);

    // 6. Verification assertions
    const totalChars = (await client.query('SELECT count(*) as c FROM "Character"')).rows[0].c;
    const charsWithArt = (await client.query('SELECT count(*) as c FROM "Character" WHERE "artworkSha256" IS NOT NULL')).rows[0].c;
    const charsWithoutArt = (await client.query('SELECT count(*) as c FROM "Character" WHERE "artworkSha256" IS NULL')).rows[0].c;
    const totalAssets = (await client.query('SELECT count(*) as c FROM "ArtworkAsset"')).rows[0].c;
    const orphans = (await client.query(`
      SELECT count(*) as c FROM "ArtworkAsset" a
      WHERE NOT EXISTS (SELECT 1 FROM "Character" c WHERE c."artworkSha256" = a.sha256)
    `)).rows[0].c;
    const favs = (await client.query('SELECT count(*) as c FROM "CharacterFavorite"')).rows[0].c;
    const cart = (await client.query('SELECT count(*) as c FROM "CharacterCartItem"')).rows[0].c;

    console.log("\nPre-commit consistency verification:");
    console.log(`- Character total:       ${totalChars} (Expected: 355)`);
    console.log(`- Character with art:    ${charsWithArt} (Expected: 354)`);
    console.log(`- Character without art: ${charsWithoutArt} (Expected: 1)`);
    console.log(`- ArtworkAsset total:    ${totalAssets} (Expected: 350)`);
    console.log(`- Orphan ArtworkAssets:  ${orphans} (Expected: 0)`);
    console.log(`- Favorites count:       ${favs} (Expected: 2)`);
    console.log(`- Cart count:            ${cart} (Expected: 2)`);

    if (totalChars !== "355") throw new Error(`Character count mismatch: ${totalChars}`);
    if (charsWithArt !== "354") throw new Error(`Characters with art mismatch: ${charsWithArt}`);
    if (charsWithoutArt !== "1") throw new Error(`Characters without art mismatch: ${charsWithoutArt}`);
    if (totalAssets !== "350") throw new Error(`ArtworkAsset count mismatch: ${totalAssets}`);
    if (orphans !== "0") throw new Error(`Orphan ArtworkAsset count mismatch: ${orphans}`);
    if (favs !== "2") throw new Error(`Favorites count mismatch: ${favs}`);
    if (cart !== "2") throw new Error(`Cart count mismatch: ${cart}`);

    console.log("\nAll assertions PASSED. Committing transaction...");
    await client.query("COMMIT");
    console.log("✓ TRANSACTION COMMITTED SUCCESSFULLY!");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Migration failed, transaction ROLLED BACK:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});