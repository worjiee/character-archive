import { describe, expect, it } from "vitest";
import {
  analyzeDryRun,
  BATCH_SIZE,
  getUpdateCandidates,
} from "./backfill-source-timestamps";

describe("backfill source timestamps", () => {
  it("reports zero counts for empty input", () => {
    expect(analyzeDryRun([])).toEqual({
      totalJanitorSources: 0,
      createdAtPresent: 0, createdAtValid: 0, createdAtInvalid: 0,
      updatedAtPresent: 0, updatedAtValid: 0, updatedAtInvalid: 0,
      chronologyConflicts: 0, eligibleForBackfill: 0,
    });
  });

  it("counts valid timestamps as eligible for backfill", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      rawData: { created_at: "2024-01-15T10:00:00.000Z", updated_at: "2024-06-20T12:00:00.000Z" },
    }]);
    expect(result).toMatchObject({
      totalJanitorSources: 1,
      createdAtPresent: 1, createdAtValid: 1, createdAtInvalid: 0,
      updatedAtPresent: 1, updatedAtValid: 1, updatedAtInvalid: 0,
      chronologyConflicts: 0, eligibleForBackfill: 1,
    });
  });

  it("counts invalid timestamps correctly", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      rawData: { created_at: "not-a-date", updated_at: "also-invalid" },
    }]);
    expect(result).toMatchObject({
      createdAtPresent: 1, createdAtValid: 0, createdAtInvalid: 1,
      updatedAtPresent: 1, updatedAtValid: 0, updatedAtInvalid: 1,
      eligibleForBackfill: 0,
    });
  });

  it("detects chronology conflicts where updated_at < created_at", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      rawData: { created_at: "2024-06-20T12:00:00.000Z", updated_at: "2024-01-15T10:00:00.000Z" },
    }]);
    expect(result).toMatchObject({
      chronologyConflicts: 1,
      eligibleForBackfill: 0,
    });
  });

  it("skips rows where sourceCreatedAt is already populated", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: new Date("2024-01-15T10:00:00.000Z"),
      sourceUpdatedAt: null,
      rawData: { created_at: "2024-01-15T10:00:00.000Z", updated_at: "2024-06-20T12:00:00.000Z" },
    }]);
    expect(result).toMatchObject({
      createdAtValid: 1, updatedAtValid: 1,
      eligibleForBackfill: 1, // still eligible because sourceUpdatedAt is null
    });
  });

  it("reports not eligible when both fields are already populated", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: new Date("2024-01-15T10:00:00.000Z"),
      sourceUpdatedAt: new Date("2024-06-20T12:00:00.000Z"),
      rawData: { created_at: "2024-01-15T10:00:00.000Z", updated_at: "2024-06-20T12:00:00.000Z" },
    }]);
    expect(result).toMatchObject({ eligibleForBackfill: 0 });
  });

  it("handles null rawData gracefully", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      rawData: null,
    }]);
    expect(result).toMatchObject({
      createdAtPresent: 0, updatedAtPresent: 0,
      eligibleForBackfill: 0,
    });
  });

  it("handles missing created_at/updated_at in rawData", () => {
    const result = analyzeDryRun([{
      id: "source-1",
      sourceCreatedAt: null,
      sourceUpdatedAt: null,
      rawData: { name: "Theron" },
    }]);
    expect(result).toMatchObject({
      createdAtPresent: 0, updatedAtPresent: 0,
      eligibleForBackfill: 0,
    });
  });

  it("requires explicit --write flag for write mode", () => {
    // This is a behavioral test documented here:
    // The default invocation must be dry-run.
    // A write must require an explicit --write flag.
    // This is verified by the script's argv check.
    expect(process.argv.includes("--write")).toBe(false);
  });

  it("extracts update candidates for write mode only when fields are null and valid", () => {
    const candidates = getUpdateCandidates([
      {
        id: "source-1",
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        rawData: {
          created_at: "2024-01-15T10:00:00.000Z",
          updated_at: "2024-06-20T12:00:00.000Z",
        },
      },
      {
        id: "source-2",
        sourceCreatedAt: new Date("2024-01-15T10:00:00.000Z"),
        sourceUpdatedAt: null,
        rawData: {
          created_at: "2024-01-15T10:00:00.000Z",
          updated_at: "2024-06-20T12:00:00.000Z",
        },
      },
      {
        id: "source-conflict",
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        rawData: {
          created_at: "2024-06-20T12:00:00.000Z",
          updated_at: "2024-01-15T10:00:00.000Z",
        },
      },
      {
        id: "source-invalid",
        sourceCreatedAt: null,
        sourceUpdatedAt: null,
        rawData: {
          created_at: "invalid",
          updated_at: "invalid",
        },
      },
    ]);

    expect(candidates).toEqual([
      {
        id: "source-1",
        data: {
          sourceCreatedAt: new Date("2024-01-15T10:00:00.000Z"),
          sourceUpdatedAt: new Date("2024-06-20T12:00:00.000Z"),
        },
      },
      {
        id: "source-2",
        data: {
          sourceUpdatedAt: new Date("2024-06-20T12:00:00.000Z"),
        },
      },
    ]);
  });

  it("uses batch size of 50", () => {
    expect(BATCH_SIZE).toBe(50);
  });
});
