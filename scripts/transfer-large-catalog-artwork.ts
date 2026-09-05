import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  APPROVED_271_BY_DIGEST,
  APPROVED_ZIP_HASHES,
} from "../src/lib/artwork/large-catalog-manifest";
import { inspectExtractorZip } from "../src/lib/importers/artifacts/index";

const PREVIEW_ORIGIN = process.env.PREVIEW_ORIGIN || "https://character-archive-git-develop-karls-projects-fccc69ea.vercel.app";
const TRANSFER_ENDPOINT = `${PREVIEW_ORIGIN}/api/admin/large-catalog-transfer`;

const ZIP_FILES = [
  { name: "SEPHA", path: "C:\\Users\\Karl\\Downloads\\janitorai_SEPHA_characters.zip", expectedSha: APPROVED_ZIP_HASHES.SEPHA },
  { name: "JeslynLemons", path: "C:\\Users\\Karl\\Downloads\\janitorai_JeslynLemons_characters.zip", expectedSha: APPROVED_ZIP_HASHES.JeslynLemons },
];

interface TransferOptions {
  operatorSecret?: string;
  sessionToken?: string;
  dryRun?: boolean;
}

export async function runLargeCatalogArtworkTransfer(options: TransferOptions = {}): Promise<{
  success: boolean;
  baselineIntact: boolean;
  totalPresent: number;
  newUploaded: number;
  newVerifiedBytes: number;
  proofToken?: string;
}> {
  console.log("===============================================================");
  console.log("STAGE B: LARGE-CATALOG ARTWORK TRANSFER & VERIFICATION");
  console.log("===============================================================");
  console.log(`Target: ${TRANSFER_ENDPOINT}`);
  console.log(`Approved Candidates: 271 objects | Baseline: 83 objects | Target Total: 354 objects`);

  // 1. Verify candidate ZIP files and their cryptographic hashes
  console.log("\n[1/5] Verifying candidate archives...");
  for (const z of ZIP_FILES) {
    if (!fs.existsSync(z.path)) {
      throw new Error(`Archive file not found: ${z.path}`);
    }
    const fileBytes = fs.readFileSync(z.path);
    const actualHash = crypto.createHash("sha256").update(fileBytes).digest("hex");
    if (actualHash !== z.expectedSha) {
      throw new Error(`Archive hash mismatch for ${z.name}: expected ${z.expectedSha}, got ${actualHash}`);
    }
    console.log(`  ✓ ${z.name} archive verified: SHA-256=${actualHash.slice(0, 16)}... (${(fileBytes.length / (1024 * 1024)).toFixed(2)} MB)`);
  }

  // 2. Set up headers for communication with Preview
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (options.operatorSecret) {
    headers["x-preview-operator-secret"] = options.operatorSecret;
  }
  if (options.sessionToken) {
    headers["Cookie"] = `character_archive_user_session=${options.sessionToken}`;
  }

  // 3. Query initial status from Preview
  console.log("\n[2/5] Querying live Blob storage inventory from Preview...");
  const statusRes = await fetch(TRANSFER_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "status" }),
  });

  if (!statusRes.ok) {
    const errText = await statusRes.text();
    throw new Error(`Failed to query transfer status (HTTP ${statusRes.status}): ${errText}`);
  }

  const { inventory } = await statusRes.json();
  console.log(`  Live Storage State:`);
  console.log(`  - Baseline Present: ${inventory.baselinePresent} / ${inventory.baselineExpected}`);
  console.log(`  - New Candidates Present: ${inventory.newPresent} / ${inventory.newExpected}`);
  console.log(`  - Missing New Candidates: ${inventory.newMissing}`);
  console.log(`  - Unexpected Objects: ${inventory.unexpected}`);

  if (inventory.baselinePresent !== 83) {
    throw new Error(`Baseline inventory mismatch: expected 83 baseline objects, found ${inventory.baselinePresent}`);
  }
  if (inventory.unexpected !== 0) {
    throw new Error(`Unexpected objects detected in Blob storage: count = ${inventory.unexpected}`);
  }

  // 4. Load missing artwork bytes from candidate ZIPs
  let uploadedCount = 0;
  if (inventory.newMissing > 0) {
    console.log(`\n[3/5] Extracting missing artwork objects from candidate archives into memory...`);
    const missingSet = new Set<string>(inventory.missingDigests);
    const bytesByDigest = new Map<string, Uint8Array>();

    for (const z of ZIP_FILES) {
      console.log(`  Scanning ${z.name}...`);
      const fileBytes = new Uint8Array(fs.readFileSync(z.path));
      const inspection = inspectExtractorZip(fileBytes);
      for (const item of inspection.items) {
        if (item.artwork && missingSet.has(item.artwork.metadata.sha256)) {
          const sha = item.artwork.metadata.sha256;
          bytesByDigest.set(sha, item.artwork.readBytes());
        }
      }
    }

    console.log(`  Extracted ${bytesByDigest.size} of ${missingSet.size} missing artwork files.`);
    if (bytesByDigest.size < missingSet.size) {
      throw new Error(`Could not find all missing artwork in candidate archives: found ${bytesByDigest.size} of ${missingSet.size}`);
    }

    // 5. Transfer missing artwork sequentially
    console.log(`\n[4/5] Transferring ${bytesByDigest.size} artwork objects to Vercel Blob...`);
    let progress = 0;
    const totalToUpload = inventory.missingDigests.length;

    for (const digest of inventory.missingDigests) {
      progress++;
      const entry = APPROVED_271_BY_DIGEST.get(digest)!;
      const pngBytes = bytesByDigest.get(digest)!;

      // Local cryptographic pre-validation
      const localHash = crypto.createHash("sha256").update(pngBytes).digest("hex");
      if (localHash !== digest || pngBytes.byteLength !== entry.byteLength) {
        throw new Error(`Local pre-check failed for ${entry.characterName} (${digest})`);
      }

      // Request capability
      const capRes = await fetch(TRANSFER_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "capability", sha256: digest }),
      });

      if (!capRes.ok) {
        const err = await capRes.text();
        throw new Error(`Capability request failed for ${digest} (HTTP ${capRes.status}): ${err}`);
      }

      const { capability } = await capRes.json();

      // PUT directly to presigned URL
      const putRes = await fetch(capability.presignedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "image/png",
        },
        body: Buffer.from(pngBytes),
      });

      if (!putRes.ok) {
        const putErr = await putRes.text();
        throw new Error(`Blob PUT failed for ${digest} (HTTP ${putRes.status}): ${putErr}`);
      }

      // Verify upload on server
      const verifyRes = await fetch(TRANSFER_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "verify", sha256: digest }),
      });

      if (!verifyRes.ok) {
        const verifyErr = await verifyRes.text();
        throw new Error(`Server verification failed for ${digest} (HTTP ${verifyRes.status}): ${verifyErr}`);
      }

      uploadedCount++;
      if (progress % 10 === 0 || progress === totalToUpload) {
        console.log(`  [${progress}/${totalToUpload}] Uploaded & verified: ${entry.characterName} (${(entry.byteLength / 1024).toFixed(0)} KB)`);
      }
    }
  } else {
    console.log("\n[3/5 & 4/5] All 271 approved candidates are already present in Blob storage!");
  }

  // 6. Cryptographic Bounded Batch Byte-Verification
  console.log(`\n[5/5] Executing bounded server-side cryptographic byte-verification of all 271 objects...`);
  const allApprovedDigests = Array.from(APPROVED_271_BY_DIGEST.keys());
  const batchSize = 25;
  let totalVerifiedBytes = 0;

  for (let i = 0; i < allApprovedDigests.length; i += batchSize) {
    const batch = allApprovedDigests.slice(i, i + batchSize);
    const batchRes = await fetch(TRANSFER_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "verify-bytes-batch", digests: batch }),
    });

    if (!batchRes.ok) {
      const err = await batchRes.text();
      throw new Error(`Batch byte-verification failed for batch ${i / batchSize + 1} (HTTP ${batchRes.status}): ${err}`);
    }

    const { verifiedDigests, failedDigests } = await batchRes.json();
    if (failedDigests.length > 0) {
      throw new Error(`Cryptographic verification failure: ${JSON.stringify(failedDigests)}`);
    }

    totalVerifiedBytes += verifiedDigests.length;
    console.log(`  ✓ Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allApprovedDigests.length / batchSize)}: ${verifiedDigests.length} objects byte-for-byte cryptographically verified (${totalVerifiedBytes}/${allApprovedDigests.length})`);
  }

  // 7. Final full reconciliation and proof token
  console.log("\nReconciling final inventory and obtaining cryptographic proof token...");
  const reconcileRes = await fetch(TRANSFER_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "reconcile" }),
  });

  if (!reconcileRes.ok) {
    const err = await reconcileRes.text();
    throw new Error(`Final reconciliation failed (HTTP ${reconcileRes.status}): ${err}`);
  }

  const { inventory: finalInventory, proofToken } = await reconcileRes.json();
  console.log("\n===============================================================");
  console.log("STAGE B VERIFICATION SUMMARY:");
  console.log("===============================================================");
  console.log(`- Expected Objects: ${finalInventory.expected}`);
  console.log(`- Baseline Objects (Immutable): ${finalInventory.baselinePresent} / ${finalInventory.baselineExpected}`);
  console.log(`- New Approved Objects Present: ${finalInventory.newPresent} / ${finalInventory.newExpected}`);
  console.log(`- Missing Objects: ${finalInventory.newMissing}`);
  console.log(`- Unexpected Objects: ${finalInventory.unexpected}`);
  console.log(`- Cryptographically Byte-Verified: ${totalVerifiedBytes} / 271`);
  console.log(`- Proof Token Issued: ${proofToken ? "YES (HMAC-SHA256 Signed)" : "NO"}`);
  console.log("===============================================================");

  const success =
    finalInventory.expected === 354 &&
    finalInventory.baselinePresent === 83 &&
    finalInventory.newPresent === 271 &&
    finalInventory.newMissing === 0 &&
    finalInventory.unexpected === 0 &&
    totalVerifiedBytes === 271;

  return {
    success,
    baselineIntact: finalInventory.baselinePresent === 83,
    totalPresent: finalInventory.presentDigests.length,
    newUploaded: uploadedCount,
    newVerifiedBytes: totalVerifiedBytes,
    proofToken,
  };
}

// CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("scripts/transfer-large-catalog-artwork.ts")) {
  const secret = process.env.PREVIEW_LARGE_CATALOG_OPERATOR_SECRET;
  const sessionToken = process.env.PREVIEW_USER_SESSION_TOKEN;

  runLargeCatalogArtworkTransfer({
    operatorSecret: secret,
    sessionToken: sessionToken,
  })
    .then((result) => {
      if (!result.success) {
        console.error("Stage B did not achieve required 354/354/0/0 verified state.");
        process.exit(1);
      }
      console.log("\n✓ Stage B successfully completed. STOPPING for owner authorization before Stage C.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("\nFATAL ERROR in Stage B transfer:", err);
      process.exit(1);
    });
}
