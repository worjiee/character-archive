import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../generated/prisma/client";

export function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const date = new Date(trimmed);
  if (!Number.isFinite(date.getTime())) return null;
  return date;
}

export interface BackfillRow {
  id: string;
  sourceCreatedAt: Date | null;
  sourceUpdatedAt: Date | null;
  rawData: unknown;
}

export interface RowAnalysis {
  createdAtPresent: boolean;
  createdAtValid: boolean;
  updatedAtPresent: boolean;
  updatedAtValid: boolean;
  chronologyConflict: boolean;
  eligible: boolean;
  parsedCreatedAt: Date | null;
  parsedUpdatedAt: Date | null;
}

export interface BackfillDryRunResult {
  totalJanitorSources: number;
  createdAtPresent: number;
  createdAtValid: number;
  createdAtInvalid: number;
  updatedAtPresent: number;
  updatedAtValid: number;
  updatedAtInvalid: number;
  chronologyConflicts: number;
  eligibleForBackfill: number;
}

export interface UpdateCandidate {
  id: string;
  data: {
    sourceCreatedAt?: Date;
    sourceUpdatedAt?: Date;
  };
}

export function analyzeRow(row: BackfillRow): RowAnalysis {
  const raw =
    typeof row.rawData === "object" && row.rawData !== null && !Array.isArray(row.rawData)
      ? (row.rawData as Record<string, unknown>)
      : null;

  const rawCreatedAt = raw?.created_at;
  const rawUpdatedAt = raw?.updated_at;

  const createdAtPresent = typeof rawCreatedAt === "string";
  const parsedCreatedAt = parseDateOrNull(rawCreatedAt);
  const createdAtValid = parsedCreatedAt !== null;

  const updatedAtPresent = typeof rawUpdatedAt === "string";
  const parsedUpdatedAt = parseDateOrNull(rawUpdatedAt);
  const updatedAtValid = parsedUpdatedAt !== null;

  const chronologyConflict =
    createdAtValid &&
    updatedAtValid &&
    parsedUpdatedAt.getTime() < parsedCreatedAt.getTime();

  const createdEligible =
    row.sourceCreatedAt === null && createdAtValid && !chronologyConflict;
  const updatedEligible =
    row.sourceUpdatedAt === null && updatedAtValid && !chronologyConflict;
  const eligible = createdEligible || updatedEligible;

  return {
    createdAtPresent,
    createdAtValid,
    updatedAtPresent,
    updatedAtValid,
    chronologyConflict,
    eligible,
    parsedCreatedAt,
    parsedUpdatedAt,
  };
}

export function analyzeDryRun(rows: BackfillRow[]): BackfillDryRunResult {
  let createdAtPresent = 0;
  let createdAtValid = 0;
  let createdAtInvalid = 0;
  let updatedAtPresent = 0;
  let updatedAtValid = 0;
  let updatedAtInvalid = 0;
  let chronologyConflicts = 0;
  let eligibleForBackfill = 0;

  for (const row of rows) {
    const analysis = analyzeRow(row);
    if (analysis.createdAtPresent) createdAtPresent++;
    if (analysis.createdAtValid) createdAtValid++;
    if (analysis.createdAtPresent && !analysis.createdAtValid) createdAtInvalid++;
    if (analysis.updatedAtPresent) updatedAtPresent++;
    if (analysis.updatedAtValid) updatedAtValid++;
    if (analysis.updatedAtPresent && !analysis.updatedAtValid) updatedAtInvalid++;
    if (analysis.chronologyConflict) chronologyConflicts++;
    if (analysis.eligible) eligibleForBackfill++;
  }

  return {
    totalJanitorSources: rows.length,
    createdAtPresent,
    createdAtValid,
    createdAtInvalid,
    updatedAtPresent,
    updatedAtValid,
    updatedAtInvalid,
    chronologyConflicts,
    eligibleForBackfill,
  };
}

export function getUpdateCandidates(rows: BackfillRow[]): UpdateCandidate[] {
  const candidates: UpdateCandidate[] = [];

  for (const row of rows) {
    const analysis = analyzeRow(row);
    if (analysis.chronologyConflict) {
      continue;
    }

    const data: { sourceCreatedAt?: Date; sourceUpdatedAt?: Date } = {};

    if (row.sourceCreatedAt === null && analysis.createdAtValid && analysis.parsedCreatedAt) {
      data.sourceCreatedAt = analysis.parsedCreatedAt;
    }

    if (row.sourceUpdatedAt === null && analysis.updatedAtValid && analysis.parsedUpdatedAt) {
      data.sourceUpdatedAt = analysis.parsedUpdatedAt;
    }

    if (data.sourceCreatedAt !== undefined || data.sourceUpdatedAt !== undefined) {
      candidates.push({ id: row.id, data });
    }
  }

  return candidates;
}

export const BATCH_SIZE = 50;

export async function executeBatchedUpdates(
  prisma: PrismaClient,
  candidates: UpdateCandidate[]
): Promise<number> {
  let totalWritten = 0;

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((item) =>
        prisma.characterSource.update({
          where: { id: item.id },
          data: item.data,
        })
      )
    );
    totalWritten += batch.length;
  }

  return totalWritten;
}

function printSummary(
  isWriteMode: boolean,
  stats: BackfillDryRunResult,
  writeResult?: { totalWritten: number; totalSkipped: number }
): void {
  console.log("\n================ Backfill Summary ================");
  console.log(`Mode:                       ${isWriteMode ? "WRITE" : "DRY-RUN"}`);
  console.log(`Total Janitor sources:      ${stats.totalJanitorSources}`);
  console.log(`created_at present:         ${stats.createdAtPresent}`);
  console.log(`created_at valid:           ${stats.createdAtValid}`);
  console.log(`created_at invalid:         ${stats.createdAtInvalid}`);
  console.log(`updated_at present:         ${stats.updatedAtPresent}`);
  console.log(`updated_at valid:           ${stats.updatedAtValid}`);
  console.log(`updated_at invalid:         ${stats.updatedAtInvalid}`);
  console.log(`Chronology conflicts:       ${stats.chronologyConflicts}`);
  console.log(`Rows eligible for backfill: ${stats.eligibleForBackfill}`);
  if (writeResult) {
    console.log(`Total written:              ${writeResult.totalWritten}`);
    console.log(`Total skipped:              ${writeResult.totalSkipped}`);
  }
  console.log("==================================================\n");
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool, { disposeExternalPool: true });
  return new PrismaClient({ adapter });
}

export async function main(): Promise<void> {
  const isWriteMode = process.argv.includes("--write");
  let prisma: PrismaClient | null = null;

  try {
    if (isWriteMode) {
      console.log("Starting backfill in WRITE mode...");
    } else {
      console.log("Starting backfill in DRY-RUN mode (pass --write to apply changes)...");
    }

    prisma = createPrismaClient();

    const sources = await prisma.characterSource.findMany({
      where: {
        platform: "JANITOR_AI",
      },
      select: {
        id: true,
        sourceCreatedAt: true,
        sourceUpdatedAt: true,
        rawData: true,
      },
    });

    const stats = analyzeDryRun(sources);

    let writeResult: { totalWritten: number; totalSkipped: number } | undefined;

    if (isWriteMode) {
      const candidates = getUpdateCandidates(sources);
      const totalWritten = await executeBatchedUpdates(prisma, candidates);
      const totalSkipped = sources.length - totalWritten;
      writeResult = { totalWritten, totalSkipped };
    }

    printSummary(isWriteMode, stats, writeResult);
  } catch (error) {
    console.error("Backfill failed:", error instanceof Error ? error.message : "Unknown error");
    process.exitCode = 1;
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") {
  void main();
}
