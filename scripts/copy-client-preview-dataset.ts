import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

const CONTENT_TABLES = [
  "RepositorySettings",
  "Tag",
  "ArtworkAsset",
  "Character",
  "CharacterSource",
  "Greeting",
  "CharacterTag",
  "SourceTag",
  "Lorebook",
  "LorebookEntry",
  "CharacterLorebook",
] as const;

const EPHEMERAL_TABLES = [
  "UserSession",
  "CharacterFavorite",
  "CharacterCartItem",
  "ImportPreviewJob",
  "BridgePairing",
  "BridgeSession",
  "BridgeJob",
  "SourceConnection",
] as const;

async function main(): Promise<void> {
  const sourceUrl = requiredUrl("SOURCE_DATABASE_URL");
  const targetUrl = requiredUrl("TARGET_DATABASE_URL");
  assertLocalSource(sourceUrl);
  assertPreviewTarget(targetUrl);
  if (fingerprint(sourceUrl.toString()) === fingerprint(targetUrl.toString())) {
    throw new Error("Source and target database identities must differ.");
  }

  const sourcePool = new Pool({ connectionString: sourceUrl.toString() });
  const targetPool = new Pool({ connectionString: targetUrl.toString() });
  const source = await sourcePool.connect();
  const target = await targetPool.connect();
  try {
    const migrations = await target.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
    );
    if (Number(migrations.rows[0]?.count) !== 13) throw new Error("Target must have exactly 13 successful Prisma migrations.");

    const targetUsers = await target.query<{ id: string; role: string; status: string }>(
      'SELECT id, role::text, "accessStatus"::text AS status FROM "User" ORDER BY id',
    );
    if (targetUsers.rows.length !== 1 || targetUsers.rows[0]?.id !== "initial-admin" || targetUsers.rows[0]?.role !== "ADMIN" || targetUsers.rows[0]?.status !== "ACTIVE") {
      throw new Error("Target must contain only the explicitly bootstrapped active initial administrator.");
    }

    const before = await tableCounts(target, [...CONTENT_TABLES, ...EPHEMERAL_TABLES]);
    for (const table of CONTENT_TABLES) {
      if (before[table] !== 0) throw new Error("Target content tables must be empty before transfer.");
    }
    for (const table of EPHEMERAL_TABLES) {
      if (before[table] !== 0) throw new Error("Target authentication and ephemeral tables must be empty before transfer.");
    }

    const sourceCounts = await tableCounts(source, [...CONTENT_TABLES]);
    await target.query("BEGIN");
    try {
      for (const table of CONTENT_TABLES) {
        await copyTable(source, target, table);
      }
      const copiedCounts = await tableCounts(target, [...CONTENT_TABLES]);
      for (const table of CONTENT_TABLES) {
        if (copiedCounts[table] !== sourceCounts[table]) throw new Error("Copied table counts do not match the approved source.");
      }
      await target.query("COMMIT");
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }

    const afterEphemeral = await tableCounts(target, [...EPHEMERAL_TABLES]);
    if (Object.values(afterEphemeral).some((count) => count !== 0)) {
      throw new Error("Ephemeral or collection data changed during the content transfer.");
    }
    console.log(JSON.stringify({ migrations: 13, contentCounts: sourceCounts, ephemeralCounts: afterEphemeral }));
  } finally {
    target.release();
    source.release();
    await Promise.all([targetPool.end(), sourcePool.end()]);
  }
}

async function copyTable(source: PoolClient, target: PoolClient, table: typeof CONTENT_TABLES[number]): Promise<void> {
  const columnsResult = await source.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
    [table],
  );
  const columns = columnsResult.rows.map(({ column_name }) => column_name);
  if (columns.length === 0) throw new Error("Approved source schema is missing a required content table.");
  const quotedColumns = columns.map(quoteIdentifier).join(", ");
  const rows = await source.query<Record<string, unknown>>(`SELECT ${quotedColumns} FROM ${quoteIdentifier(table)}`);
  for (const row of rows.rows) {
    const values = columns.map((column) => {
      if ((table === "Character" || table === "CharacterSource") && column === "firstAddedByUserId") return "initial-admin";
      return row[column];
    });
    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await target.query(
      `INSERT INTO ${quoteIdentifier(table)} (${quotedColumns}) VALUES (${placeholders})`,
      values,
    );
  }
}

async function tableCounts(client: PoolClient, tables: readonly string[]): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${quoteIdentifier(table)}`);
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

function requiredUrl(name: "SOURCE_DATABASE_URL" | "TARGET_DATABASE_URL"): URL {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in the trusted transfer shell.`);
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL.`);
  }
}

function assertLocalSource(url: URL): void {
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("The approved dataset source must be local PostgreSQL.");
  }
}

function assertPreviewTarget(url: URL): void {
  if (!["postgres:", "postgresql:"].includes(url.protocol) || ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || !/supabase/i.test(url.hostname)) {
    throw new Error("The transfer target must be the non-local Supabase Client Preview database.");
  }
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new Error("Unsafe database identifier.");
  return `"${value}"`;
}

void main().catch(() => {
  console.error("Client Preview dataset copy failed a guarded precondition or transaction.");
  process.exitCode = 1;
});
