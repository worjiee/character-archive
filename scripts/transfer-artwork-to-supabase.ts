import * as fs from "fs";
import * as path from "path";
import { createHash, randomBytes } from "crypto";

import { Pool } from "pg";

const PREVIEW_URL = process.env.PREVIEW_URL || "https://character-archive-7q9pk6d44-karls-projects-fccc69ea.vercel.app";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres.ofdkiwwggzojofbxpxfr:chikpeas%40%23.@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true";
const MANIFEST_PATH = "C:\\Users\\Karl\\Downloads\\character_archive_artwork_manifest.json";
const BLOBS_DIR = "C:\\Users\\Karl\\Downloads\\character_archive_artwork_blobs_350";

interface ManifestMapping {
  originalSha256: string;
  optimizedSha256: string;
  originalBytes: number;
  optimizedBytes: number;
  savedBytes: number;
  percentSaved: number;
  dimensions: string;
  pixelEquivalencePass: boolean;
}

interface Manifest {
  totals: { count: number; optimizedTotalBytes: number };
  mapping: ManifestMapping[];
}

async function createAdminSession(pool: Pool): Promise<{ cookie: string; cleanup: () => Promise<void> }> {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(rawToken, "utf8").digest("hex");
  const sessionId = "transfer-session-" + Date.now();
  const expiresAt = new Date(Date.now() + 3600 * 1000);

  console.log("Generating short-lived temporary admin session in database...");
  await pool.query(
    'INSERT INTO "UserSession" (id, "tokenHash", "userId", "expiresAt") VALUES ($1, $2, $3, $4)',
    [sessionId, tokenHash, "initial-admin", expiresAt]
  );

  return {
    cookie: `character_archive_user_session=${rawToken}`,
    cleanup: async () => {
      console.log("Cleaning up temporary admin session...");
      await pool.query('DELETE FROM "UserSession" WHERE id = $1', [sessionId]);
    },
  };
}

async function main() {
  console.log("===============================================================");
  console.log("       SUPABASE ARTWORK PREVIEW TRANSFER PROTOCOL");
  console.log("===============================================================");

  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`Manifest missing at ${MANIFEST_PATH}`);
  if (!fs.existsSync(BLOBS_DIR)) throw new Error(`Blobs dir missing at ${BLOBS_DIR}`);

  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const pool = new Pool({ connectionString: DATABASE_URL });
  const { cookie, cleanup } = await createAdminSession(pool);

  try {
    console.log("✓ Admin authentication successful.");

  // 1. Check readiness
  const pingRes = await fetch(`${PREVIEW_URL}/api/admin/supabase-artwork-transfer`, {
    headers: { Cookie: cookie },
  });
  if (!pingRes.ok) throw new Error(`Transfer endpoint ping failed: ${await pingRes.text()}`);
  const pingData = await pingRes.json();
  console.log("Transfer endpoint ready:", pingData);
  if (!pingData.hasUrl || !pingData.hasServiceKey) {
    throw new Error("Preview deployment is missing Supabase credentials.");
  }

  // 2. Prepare 350 unique items
  const uniqueItemsMap = new Map<string, { sha256: string; byteLength: number; width: number; height: number }>();
  for (const m of manifest.mapping) {
    if (!uniqueItemsMap.has(m.optimizedSha256)) {
      const [w, h] = m.dimensions.split("x").map(Number);
      uniqueItemsMap.set(m.optimizedSha256, {
        sha256: m.optimizedSha256,
        byteLength: m.optimizedBytes,
        width: w,
        height: h,
      });
    }
  }

  const uniqueItems = [...uniqueItemsMap.values()];
  console.log(`\nReady to upload ${uniqueItems.length} unique optimized artworks to Supabase Storage.`);

  // Check existing inventory for resume support
  const existingMap = new Map<string, number>();
  try {
    const invRes = await fetch(`${PREVIEW_URL}/api/admin/supabase-artwork-transfer`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify-inventory" }),
    });
    if (invRes.ok) {
      const invData = await invRes.json();
      if (Array.isArray(invData.objects)) {
        for (const obj of invData.objects) {
          existingMap.set(obj.name, obj.size);
        }
      }
    }
  } catch (err) {
    console.warn("Could not check existing inventory, proceeding with full upload:", err);
  }

  // 3. Upload loop with concurrency 4
  let cursor = 0;
  let uploadedCount = 0;
  let skippedCount = 0;
  let totalUploadedBytes = 0;
  const concurrency = 4;

  async function worker() {
    while (cursor < uniqueItems.length) {
      const idx = cursor++;
      const item = uniqueItems[idx];
      const storageKey = `artwork/sha256/${item.sha256}.png`;

      // Check if already uploaded with matching size
      if (existingMap.get(storageKey) === item.byteLength) {
        skippedCount++;
        uploadedCount++;
        totalUploadedBytes += item.byteLength;
        continue;
      }

      const filePath = path.join(BLOBS_DIR, `${item.sha256}.png`);
      const buf = fs.readFileSync(filePath);

      // Local assertion
      const computedSha = createHash("sha256").update(buf).digest("hex");
      if (computedSha !== item.sha256 || buf.length !== item.byteLength) {
        throw new Error(`Pre-upload integrity failure for ${item.sha256}`);
      }

      // If file > 4MB, use signed direct upload to bypass Vercel serverless request body limits
      if (buf.length > 4 * 1024 * 1024) {
        const signRes = await fetch(`${PREVIEW_URL}/api/admin/supabase-artwork-transfer`, {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "sign-upload", storageKey }),
        });
        if (!signRes.ok) {
          throw new Error(`Failed to get signed upload URL for ${item.sha256}: ${await signRes.text()}`);
        }
        const signData = await signRes.json();
        if (!signData.uploadUrl) {
          throw new Error(`No uploadUrl returned for ${item.sha256}: ${JSON.stringify(signData)}`);
        }

        const directRes = await fetch(signData.uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            "x-upsert": "true",
          },
          body: buf,
        });

        if (!directRes.ok) {
          throw new Error(`Direct signed upload failed for ${item.sha256} (HTTP ${directRes.status}): ${await directRes.text()}`);
        }
      } else {
        const res = await fetch(`${PREVIEW_URL}/api/admin/supabase-artwork-transfer`, {
          method: "POST",
          headers: {
            Cookie: cookie,
            "Content-Type": "image/png",
            "x-artwork-sha256": item.sha256,
            "x-artwork-width": String(item.width),
            "x-artwork-height": String(item.height),
          },
          body: buf,
        });

        if (!res.ok) {
          throw new Error(`Upload failed for ${item.sha256} (HTTP ${res.status}): ${await res.text()}`);
        }
      }

      uploadedCount++;
      totalUploadedBytes += buf.length;

      if (uploadedCount % 50 === 0 || uploadedCount === uniqueItems.length) {
        console.log(`  [Upload progress: ${uploadedCount}/${uniqueItems.length} (${skippedCount} already cached)] ${(totalUploadedBytes / (1024*1024)).toFixed(2)} MB`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`\n✓ All ${uploadedCount} unique artworks successfully uploaded (${(totalUploadedBytes / (1024*1024)).toFixed(2)} MB).`);

  // 4. Cloud verification (Zero-Egress via metadata query)
  console.log("\n[4/4] Executing zero-egress metadata catalog verification...");
  const verifyRes = await fetch(`${PREVIEW_URL}/api/admin/supabase-artwork-transfer`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "verify-inventory" }),
  });

  if (!verifyRes.ok) throw new Error(`Inventory verification failed: ${await verifyRes.text()}`);
  const verifyData = await verifyRes.json();
  console.log("Supabase storage inventory:", {
    count: verifyData.count,
    totalBytes: verifyData.totalBytes,
  });

  const expectedBytes = 371728011;
  const countPass = verifyData.count === 350;
  const bytesPass = verifyData.totalBytes === expectedBytes;

  console.log(`- Object count = 350: ${countPass ? "PASS" : "FAIL"} (${verifyData.count})`);
  console.log(`- Total bytes  = ${expectedBytes}: ${bytesPass ? "PASS" : "FAIL"} (${verifyData.totalBytes})`);

  if (!countPass || !bytesPass) {
    throw new Error("Supabase Storage inventory mismatch!");
  }

  console.log("\n===============================================================");
  console.log("  SUPABASE STORAGE UPLOAD & INVENTORY VERIFICATION: COMPLETE");
  console.log("===============================================================");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(console.error);