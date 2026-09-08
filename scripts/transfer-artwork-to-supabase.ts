import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

const PREVIEW_URL = process.env.PREVIEW_URL || "https://character-archive-preview.vercel.app";
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

async function loginAdmin(baseUrl: string): Promise<string> {
  const username = process.env.PREVIEW_ADMIN_USERNAME || "preview-admin";
  const password = process.env.PREVIEW_ADMIN_PASSWORD || "chikpeas2026";

  console.log(`Authenticating admin session on ${baseUrl}...`);
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`Admin login failed (HTTP ${res.status}): ${await res.text()}`);
  }

  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error("Login response did not include set-cookie header.");
  // Extract session token
  const match = /user_session=([^;]+)/.exec(setCookie);
  if (!match) throw new Error("Could not extract user_session from set-cookie.");
  return `user_session=${match[1]}`;
}

async function main() {
  console.log("===============================================================");
  console.log("       SUPABASE ARTWORK PREVIEW TRANSFER PROTOCOL");
  console.log("===============================================================");

  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`Manifest missing at ${MANIFEST_PATH}`);
  if (!fs.existsSync(BLOBS_DIR)) throw new Error(`Blobs dir missing at ${BLOBS_DIR}`);

  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const cookie = await loginAdmin(PREVIEW_URL);
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

  // 3. Upload loop with concurrency 6
  let cursor = 0;
  let uploadedCount = 0;
  let totalUploadedBytes = 0;
  const concurrency = 6;

  async function worker() {
    while (cursor < uniqueItems.length) {
      const idx = cursor++;
      const item = uniqueItems[idx];
      const filePath = path.join(BLOBS_DIR, `${item.sha256}.png`);
      const buf = fs.readFileSync(filePath);

      // Local assertion
      const computedSha = createHash("sha256").update(buf).digest("hex");
      if (computedSha !== item.sha256 || buf.length !== item.byteLength) {
        throw new Error(`Pre-upload integrity failure for ${item.sha256}`);
      }

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

      uploadedCount++;
      totalUploadedBytes += buf.length;

      if (uploadedCount % 50 === 0 || uploadedCount === uniqueItems.length) {
        console.log(`  [Upload progress: ${uploadedCount}/${uniqueItems.length}] ${(totalUploadedBytes / (1024*1024)).toFixed(2)} MB transferred`);
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
}

main().catch(console.error);