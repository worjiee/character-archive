import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import {
  assertFinalArtworkStorageKey,
  assertMetadataMatchesBytes,
  VercelBlobArtworkObjectStore,
} from "../src/lib/artwork";

interface ArtworkRow {
  sha256: string;
  mediaType: string;
  byteLength: number;
  width: number;
  height: number;
  storageKey: string;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("The local source DATABASE_URL is required.");
  const sourceUrl = new URL(connectionString);
  if (!["localhost", "127.0.0.1", "::1"].includes(sourceUrl.hostname)) {
    throw new Error("Artwork copy source must be the accepted local PostgreSQL database.");
  }
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query<ArtworkRow>(
      'SELECT sha256, "mediaType", "byteLength", width, height, "storageKey" FROM "ArtworkAsset" ORDER BY sha256',
    );
    const rows = result.rows;
    if (rows.length === 0) throw new Error("No approved local ArtworkAssets were found.");
    const store = new VercelBlobArtworkObjectStore();
    const localRoot = path.resolve(process.cwd(), ".var", "artwork");
    let created = 0;
    let reused = 0;
    let verifiedBytes = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      assertFinalArtworkStorageKey(row.storageKey);
      if (row.mediaType !== "image/png") throw new Error("Artwork metadata contains an unsupported media type.");
      const bytes = new Uint8Array(await readFile(path.join(localRoot, ...row.storageKey.split("/"))));
      const metadata = {
        sha256: row.sha256,
        mediaType: "image/png" as const,
        byteLength: row.byteLength,
        width: row.width,
        height: row.height,
      };
      assertMetadataMatchesBytes(bytes, metadata);
      const promoted = await store.putVerifiedFinal(bytes, metadata);
      if (promoted.storageKey !== row.storageKey) throw new Error("Artwork storage key does not match its digest.");
      if (promoted.created) created += 1;
      else reused += 1;
      verifiedBytes += bytes.byteLength;
      if ((index + 1) % 10 === 0 || index + 1 === rows.length) {
        console.log(JSON.stringify({ progress: index + 1, total: rows.length }));
      }
    }

    let verified = 0;
    for (const row of rows) {
      const bytes = await store.readFinal(row.storageKey);
      if (!bytes || bytes.byteLength !== row.byteLength || createHash("sha256").update(bytes).digest("hex") !== row.sha256) {
        throw new Error("Preview artwork verification failed.");
      }
      verified += 1;
    }
    console.log(JSON.stringify({ copied: created, reused, verified, verifiedBytes }));
  } finally {
    await pool.end();
  }
}

void main();
