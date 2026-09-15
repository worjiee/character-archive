"use client";

import { useState } from "react";
import type { ArchiveHealthStatus, ValidationResult } from "@/src/lib/backup/types";
import { SettingsNavigation } from "./settings-navigation";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function BackupRecoveryDashboard({
  initialHealth,
}: {
  initialHealth: ArchiveHealthStatus;
}) {
  const [health, setHealth] = useState<ArchiveHealthStatus>(initialHealth);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Manifest validator state
  const [manifestInput, setManifestInput] = useState("");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleRefresh(spotCheck = false) {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const res = await fetch(`/api/admin/backups/health${spotCheck ? "?spotCheck=true" : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch health: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.health) {
        setHealth(data.health);
      }
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "Failed to refresh archive health.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleValidateManifest(jsonText: string) {
    if (!jsonText.trim()) return;
    setIsValidating(true);
    setValidationError(null);
    setValidationResult(null);

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error("Invalid JSON syntax. Please check the pasted manifest text.");
      }

      const res = await fetch("/api/admin/backups/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.message || `Validation request failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      setValidationResult(data.result);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : "Validation error occurred.");
    } finally {
      setIsValidating(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setManifestInput(content);
      void handleValidateManifest(content);
    };
    reader.readAsText(file);
  }

  const allIntegrityHealthy =
    health.artwork.missingCurrentArtwork.length === 0 &&
    health.artwork.brokenHistoricalArtwork.length === 0 &&
    health.artwork.orphanArtwork.length === 0 &&
    health.artwork.storageMismatch.length === 0;

  return (
    <div className="mx-auto max-w-6xl pb-16">
      {/* Header */}
      <div className="border-b border-zinc-800 pb-5">
        <p className="archive-eyebrow">Administration</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-zinc-100 sm:text-3xl">
          Backup & Recovery Center
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Disaster recovery architecture, cryptographic manifest validation, and authoritative logical backup tooling.
        </p>
        <SettingsNavigation active="backups" />
      </div>

      {refreshError && (
        <div role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {refreshError}
        </div>
      )}

      {/* Top Status Banner */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-3 w-3 rounded-full ${
              allIntegrityHealthy ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]"
            }`}
          />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold uppercase tracking-wider text-zinc-200">
                Archive Health Status:
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${
                  allIntegrityHealthy
                    ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                }`}
              >
                {allIntegrityHealthy ? "All Systems Verified" : "Review Attention Needed"}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-400">
              Prisma Migration: <span className="font-mono text-zinc-300">{health.migrations.latestMigration}</span> ({health.migrations.appliedCount} applied)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void handleRefresh(false)}
            className="archive-focus rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-200 hover:bg-zinc-750 disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "Refresh Health"}
          </button>
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => void handleRefresh(true)}
            title="Performs zero-egress checks + sample storage spot check"
            className="archive-focus rounded-lg border border-zinc-700/60 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 disabled:opacity-50"
          >
            Deep Spot Check
          </button>
        </div>
      </div>

      {/* Inventory & Entity Counts */}
      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Catalog & Storage Inventory
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <span className="text-[0.68rem] font-bold uppercase tracking-wider text-zinc-500">Characters</span>
            <p className="mt-1 text-2xl font-extrabold text-zinc-100">{health.database.totalCharacters}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <span className="text-[0.68rem] font-bold uppercase tracking-wider text-zinc-500">Sources</span>
            <p className="mt-1 text-2xl font-extrabold text-zinc-100">{health.database.totalSources}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <span className="text-[0.68rem] font-bold uppercase tracking-wider text-zinc-500">Versions</span>
            <p className="mt-1 text-2xl font-extrabold text-zinc-100">{health.database.totalVersions}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <span className="text-[0.68rem] font-bold uppercase tracking-wider text-zinc-500">Artwork Assets</span>
            <p className="mt-1 text-2xl font-extrabold text-zinc-100">{health.artwork.totalAssets}</p>
            <span className="text-[0.65rem] text-zinc-500">{formatBytes(health.artwork.totalBytes)}</span>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <span className="text-[0.68rem] font-bold uppercase tracking-wider text-zinc-500">Greetings</span>
            <p className="mt-1 text-2xl font-extrabold text-zinc-100">{health.database.totalGreetings}</p>
          </div>
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <span className="text-[0.68rem] font-bold uppercase tracking-wider text-zinc-500">Lorebooks</span>
            <p className="mt-1 text-2xl font-extrabold text-zinc-100">{health.database.totalLorebooks}</p>
          </div>
        </div>
      </section>

      {/* Cross-Reference Data Integrity */}
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Cross-Reference Data Integrity (Zero-Egress)
          </h2>
          <span className="text-xs text-zinc-500 font-mono">
            Operational Sessions: {health.operational.sessionCount} (ephemeral)
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Missing Current Artwork</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${
                  health.artwork.missingCurrentArtwork.length === 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {health.artwork.missingCurrentArtwork.length}
              </span>
            </div>
            <p className="mt-2 text-[0.72rem] text-zinc-500">
              Characters whose current artworkSha256 lacks an ArtworkAsset record.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Broken Historical Refs</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${
                  health.artwork.brokenHistoricalArtwork.length === 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {health.artwork.brokenHistoricalArtwork.length}
              </span>
            </div>
            <p className="mt-2 text-[0.72rem] text-zinc-500">
              CharacterVersion snapshots pointing to non-existent ArtworkAsset records.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Orphan Artwork Assets</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${
                  health.artwork.orphanArtwork.length === 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-amber-500/10 text-amber-400"
                }`}
              >
                {health.artwork.orphanArtwork.length}
              </span>
            </div>
            <p className="mt-2 text-[0.72rem] text-zinc-500">
              ArtworkAsset records neither referenced by current Character nor any historical Version.
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">Storage Mismatches</span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-bold font-mono ${
                  health.artwork.storageMismatch.length === 0
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {health.artwork.storageMismatch.length}
              </span>
            </div>
            <p className="mt-2 text-[0.72rem] text-zinc-500">
              Artwork assets in database missing from Supabase Storage bucket listing.
            </p>
          </div>
        </div>
      </section>

      {/* CLI Operations & Architecture Guide */}
      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
          Disaster Recovery Architecture & CLI Workflow
        </h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-3">
          {/* Hybrid Architecture Card */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
            <div className="flex items-center gap-2">
              <span className="archive-chip">Architecture</span>
              <h3 className="text-sm font-semibold text-zinc-200">Hybrid Model</h3>
            </div>
            <ul className="mt-3 space-y-2 text-xs text-zinc-400 leading-relaxed">
              <li>
                <strong className="text-zinc-200">Logical PostgreSQL Dump:</strong> Authoritative dump via native <code className="text-amber-400 font-mono">pg_dump -Fc</code>. Preserves complete schema, constraints, migrations, and durable data.
              </li>
              <li>
                <strong className="text-zinc-200">Ephemeral Exclusion:</strong> Data in <code className="text-zinc-300 font-mono">UserSession</code>, <code className="text-zinc-300 font-mono">ImportPreviewJob</code>, and <code className="text-zinc-300 font-mono">Bridge*</code> tables are excluded by design.
              </li>
              <li>
                <strong className="text-zinc-200">Content-Addressed Artwork:</strong> Optimized PNGs stored as <code className="text-zinc-300 font-mono">artwork/&lt;sha256&gt;.png</code>. Deduplicated across catalog and Version History.
              </li>
              <li>
                <strong className="text-zinc-200">Cryptographic Manifest:</strong> Deterministic <code className="text-zinc-300 font-mono">manifest.json</code> with SHA-256 for every asset and cumulative <code className="text-zinc-300 font-mono">packageDigest</code>.
              </li>
            </ul>
          </div>

          {/* Backup Command */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
            <div className="flex items-center gap-2">
              <span className="archive-chip">Create Backup</span>
              <h3 className="text-sm font-semibold text-zinc-200">CLI Orchestration</h3>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Run locally or on a maintenance runner. Streams dump and artwork directly to disk without web timeouts.
            </p>
            <div className="mt-3 rounded-lg bg-zinc-950 p-3 font-mono text-xs text-emerald-400 overflow-x-auto">
              npm run backup:create
            </div>
            <div className="mt-3 text-[0.72rem] text-zinc-500 space-y-1">
              <p>• Uses official PostgreSQL client binary (<code className="text-zinc-400">pg_dump</code>).</p>
              <p>• Writes staging to <code className="text-zinc-400">backups/.incomplete-*</code>.</p>
              <p>• Verifies SHA-256 hashes offline before atomic rename.</p>
              <p>• Sets restrictive file permissions (<code className="text-zinc-400">0600</code>).</p>
            </div>
          </div>

          {/* Verification & Restore */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-5">
            <div className="flex items-center gap-2">
              <span className="archive-chip">Verify & Restore</span>
              <h3 className="text-sm font-semibold text-zinc-200">Guarded Recovery</h3>
            </div>
            <p className="mt-2 text-xs text-zinc-400">
              Offline package validation and guarded restore targeting isolated test or disaster-recovery environments.
            </p>
            <div className="mt-3 space-y-2">
              <div className="rounded-lg bg-zinc-950 p-2.5 font-mono text-xs text-amber-400 overflow-x-auto">
                npm run backup:verify &lt;dir&gt;
              </div>
              <div className="rounded-lg bg-zinc-950 p-2.5 font-mono text-xs text-sky-400 overflow-x-auto">
                npm run backup:restore &lt;dir&gt;
              </div>
            </div>
            <div className="mt-3 text-[0.72rem] text-zinc-500 space-y-1">
              <p>• Zero web in-place restore: Prevents accidental live production wipes.</p>
              <p>• Refuses non-empty database targets unless verified.</p>
              <p>• Artwork sync compares SHA-256 before any upload.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Manifest Inspector & Validator */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-4">
          <div>
            <span className="archive-chip">Offline Tooling</span>
            <h2 className="mt-1 text-base font-bold text-zinc-100">
              Manifest Inspector & Validator
            </h2>
            <p className="text-xs text-zinc-400">
              Inspect, parse, and validate a <code className="text-amber-400">manifest.json</code> against archive standards.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-800/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-300 hover:bg-zinc-700">
              Upload manifest.json
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-zinc-400">
            Paste manifest JSON text:
          </label>
          <textarea
            rows={5}
            value={manifestInput}
            onChange={(e) => setManifestInput(e.target.value)}
            placeholder='{"format": "character-archive-backup", "formatVersion": 1, ...}'
            className="archive-input mt-2 font-mono text-xs w-full bg-zinc-950/80 text-zinc-300"
          />
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              disabled={isValidating || !manifestInput.trim()}
              onClick={() => void handleValidateManifest(manifestInput)}
              className="archive-focus rounded-lg border border-[color:var(--archive-accent)] bg-[color:var(--archive-accent)]/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[color:var(--archive-accent)] hover:bg-[color:var(--archive-accent)]/20 disabled:opacity-40"
            >
              {isValidating ? "Validating…" : "Validate Manifest"}
            </button>
          </div>
        </div>

        {validationError && (
          <div role="alert" className="mt-4 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
            <strong>Validation Error:</strong> {validationError}
          </div>
        )}

        {validationResult && (
          <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/60 p-5">
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex h-2.5 w-2.5 rounded-full ${
                  validationResult.valid ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
                {validationResult.valid ? "Manifest Validated Successfully" : "Manifest Validation Failed"}
              </h3>
            </div>

            {validationResult.errors.length > 0 && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                <p className="text-xs font-bold text-red-300">Validation Errors ({validationResult.errors.length}):</p>
                <ul className="mt-1 list-disc list-inside space-y-1 text-xs text-red-400 font-mono">
                  {validationResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {validationResult.warnings.length > 0 && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs font-bold text-amber-300">Warnings ({validationResult.warnings.length}):</p>
                <ul className="mt-1 list-disc list-inside space-y-1 text-xs text-amber-400 font-mono">
                  {validationResult.warnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              </div>
            )}

            {validationResult.summary && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 text-xs text-zinc-400">
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-zinc-500">Created At</span>
                  <p className="mt-1 font-mono text-zinc-200">{new Date(validationResult.summary.createdAt).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-zinc-500">Git Commit</span>
                  <p className="mt-1 font-mono text-zinc-200">{validationResult.summary.gitCommitSha.slice(0, 8)}</p>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-zinc-500">PostgreSQL Dump</span>
                  <p className="mt-1 font-mono text-zinc-200">{formatBytes(validationResult.summary.dbBytes)}</p>
                  <span className="text-[0.6rem] font-mono text-zinc-500">{validationResult.summary.dbSha256.slice(0, 12)}…</span>
                </div>
                <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-zinc-500">Artwork Package</span>
                  <p className="mt-1 font-mono text-zinc-200">{validationResult.summary.artworkObjectCount} objects</p>
                  <span className="text-[0.6rem] font-mono text-zinc-500">{formatBytes(validationResult.summary.totalArtworkBytes)}</span>
                </div>
                <div className="col-span-2 sm:col-span-3 lg:col-span-4 rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3">
                  <span className="text-[0.65rem] font-bold uppercase tracking-wider text-zinc-500">Package Digest (SHA-256)</span>
                  <p className="mt-1 font-mono text-xs text-emerald-400 break-all">{validationResult.summary.packageDigest}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
