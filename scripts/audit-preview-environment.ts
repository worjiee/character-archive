import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "dotenv";

async function main(): Promise<void> {
  const envPath = process.env.PREVIEW_ENV_AUDIT_PATH?.trim();
  const preview = envPath ? parse(await readFile(envPath)) : process.env;
  const required = ["DATABASE_URL", "BLOB_STORE_ID", "BLOB_WEBHOOK_PUBLIC_KEY"];
  const missingNames = required.filter((name) => !preview[name]);
  const databaseUrl = preview.DATABASE_URL ?? "";
  let parsedDatabaseUrl: URL | null = null;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    // Report a boolean only; never echo the malformed credential.
  }
  const localDatabaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");

  console.log(JSON.stringify({
    requiredNamesPresent: missingNames.length === 0,
    missingNames,
    databaseProtocolPostgres: Boolean(parsedDatabaseUrl && ["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)),
    databaseHostIsLocal: Boolean(parsedDatabaseUrl && ["localhost", "127.0.0.1", "::1"].includes(parsedDatabaseUrl.hostname)),
    databaseLooksSupabase: Boolean(parsedDatabaseUrl && /supabase/i.test(parsedDatabaseUrl.hostname)),
    previewDatabaseDiffersFromLocal: Boolean(databaseUrl && localDatabaseUrl && hash(databaseUrl) !== hash(localDatabaseUrl)),
    blobTokenNonempty: Boolean(preview.BLOB_READ_WRITE_TOKEN),
    blobOidcAvailable: Boolean(preview.VERCEL_OIDC_TOKEN && preview.BLOB_STORE_ID),
    blobStoreIdNonempty: Boolean(preview.BLOB_STORE_ID),
    artworkProvider: preview.ARTWORK_STORAGE_PROVIDER === "vercel-blob" ? "vercel-blob" : "missing-or-invalid",
    noDevelopmentFixtureFlag: !preview.ENABLE_DEVELOPMENT_FIXTURES,
  }));
}

void main();
