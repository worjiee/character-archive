"use client";

import { useEffect, useMemo, useState } from "react";
import {
  bridgePairingRequestForUrl,
  type BridgePairingRequest,
  type BridgeTarget,
} from "../src/lib/bridge/target";
import type { ImportPreview } from "@/src/lib/importers/workflow";

type ProfileItemStatus = "DISCOVERED" | "SELECTED" | "QUEUED" | "RETRIEVING" | "PREVIEW_READY" | "AUTH_REQUIRED" | "NOT_FOUND" | "RATE_LIMITED" | "INVALID_PAYLOAD" | "FAILED" | "CANCELLED" | "PREVIEW_EXPIRED" | "SAVED";
interface ProfileItem {
  externalId: string; name: string; avatarUrl: string | null; creatorName: string | null;
  status: ProfileItemStatus; previewJobId: string | null; previewExpiresAt: string | null;
  duplicateClassification: string | null; moderationBlocked: boolean | null; errorCode: string | null;
}
interface ProfileCoordinator {
  kind: "PROFILE_IMPORT"; phase: "DISCOVERING" | "DISCOVERED" | "RETRIEVING" | "REVIEW" | "CANCELLED";
  profileId: string; truncated: boolean; reportedTotal: number | null; selectedIds: string[]; items: ProfileItem[];
}
interface BridgeJob {
  id: string;
  status: "WAITING" | "PAIRED" | "READY" | "SAVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  expiresAt: string; previewJobId: string | null; preview: ImportPreview | null; profile: ProfileCoordinator | null;
  target: BridgeTarget | null;
}
type LocalSave = { status: "SAVING" | "SAVED" | "FAILED"; message?: string };

export function JanitorBridgePanel({ targetUrl, onPreview }: { targetUrl: string; onPreview: (previewJobId: string, preview: ImportPreview) => void }) {
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [job, setJob] = useState<BridgeJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [discoverySelection, setDiscoverySelection] = useState<Set<string>>(new Set());
  const [saveSelection, setSaveSelection] = useState<Set<string>>(new Set());
  const [saveResults, setSaveResults] = useState<Record<string, LocalSave>>({});
  const jobId = job?.id ?? null;
  const jobStatus = job?.status ?? null;
  const pairingRequest = useMemo(() => safePairingRequest(targetUrl), [targetUrl]);

  useEffect(() => {
    if (!jobId || !jobStatus || ["READY", "SAVED", "CANCELLED", "EXPIRED", "REJECTED"].includes(jobStatus)) return;
    const poll = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/bridge/jobs/${jobId}`, { cache: "no-store" });
        const body = await response.json();
        if (response.ok && body.job) {
          const nextJob = body.job as BridgeJob;
          setJob((current) => ({ ...nextJob, target: nextJob.target ?? current?.target ?? null }));
          setSecondsRemaining(secondsUntil(nextJob.expiresAt));
        }
      } catch { /* The next bounded poll can recover. */ }
    }, 2000);
    return () => window.clearInterval(poll);
  }, [jobId, jobStatus]);

  useEffect(() => {
    if (!jobId) return;
    const timer = window.setInterval(() => setSecondsRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [jobId]);

  const profile = job?.profile ?? null;
  const readyItems = profile?.items.filter((item) => item.status === "PREVIEW_READY" && item.previewJobId && (!item.previewExpiresAt || new Date(item.previewExpiresAt).getTime() > Date.now())) ?? [];
  const progress = useMemo(() => {
    const selected = new Set(profile?.selectedIds ?? []);
    const items = profile?.items.filter((item) => selected.has(item.externalId)) ?? [];
    return {
      ready: items.filter((item) => item.status === "PREVIEW_READY").length,
      failed: items.filter((item) => ["AUTH_REQUIRED", "NOT_FOUND", "RATE_LIMITED", "INVALID_PAYLOAD", "FAILED"].includes(item.status)).length,
      queued: items.filter((item) => ["SELECTED", "QUEUED", "RETRIEVING"].includes(item.status)).length,
    };
  }, [profile]);

  async function pair(): Promise<void> {
    setBusy(true); setError(null); setDiscoverySelection(new Set()); setSaveSelection(new Set()); setSaveResults({});
    try {
      if (!pairingRequest) throw new Error("Enter a valid Janitor character or profile URL before pairing.");
      const response = await fetch("/api/bridge/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pairingRequest) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Bridge pairing failed.");
      setPairingCode(body.pairingCode);
      setJob({ id: body.jobId, status: "WAITING", expiresAt: body.expiresAt, previewJobId: null, preview: null, profile: null, target: body.target });
      setSecondsRemaining(secondsUntil(body.expiresAt));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Bridge pairing failed."); }
    finally { setBusy(false); }
  }

  async function cancel(): Promise<void> {
    if (!job) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/bridge/jobs/${job.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Bridge cancellation failed.");
      setJob({ ...job, status: "CANCELLED" }); setPairingCode(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Bridge cancellation failed."); }
    finally { setBusy(false); }
  }

  async function submitSelection(): Promise<void> {
    if (!job || !profile || discoverySelection.size === 0) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/bridge/jobs/${job.id}/profile/selection`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ selectedIds: [...discoverySelection] }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Profile selection was rejected.");
      setJob({ ...job, profile: body.profile ?? body });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Profile selection was rejected."); }
    finally { setBusy(false); }
  }

  async function reviewItem(item: ProfileItem): Promise<void> {
    if (!item.previewJobId) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/import/previews/${item.previewJobId}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Preview could not be loaded.");
      onPreview(body.previewJobId, body.preview);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Preview could not be loaded."); }
    finally { setBusy(false); }
  }

  async function saveSelected(): Promise<void> {
    const selected = readyItems.filter((item) => item.previewJobId && saveSelection.has(item.externalId));
    if (selected.length === 0) return;
    setBusy(true); setError(null);
    for (const item of selected) {
      const previewJobId = item.previewJobId!;
      setSaveResults((current) => ({ ...current, [item.externalId]: { status: "SAVING" } }));
      try {
        const response = await fetch("/api/import/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: "browser-bridge", previewJobId, linkMode: "CREATE_SEPARATE" }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message ?? "Save failed.");
        setSaveResults((current) => ({ ...current, [item.externalId]: { status: "SAVED" } }));
        setSaveSelection((current) => { const next = new Set(current); next.delete(item.externalId); return next; });
      } catch (caught) {
        setSaveResults((current) => ({ ...current, [item.externalId]: { status: "FAILED", message: caught instanceof Error ? caught.message : "Save failed." } }));
      }
    }
    setBusy(false);
  }

  const expiry = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}`;
  const selectableIds = profile?.items.map((item) => item.externalId) ?? [];

  return <div className="mt-4 rounded-xl border border-[color:var(--archive-accent-border)] bg-zinc-900/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-zinc-200">Character Archive Companion</p><p className="mt-1 text-[11px] text-zinc-500">Janitor character and bounded profile transfer.</p><p className="mt-1 text-xs text-zinc-400">{bridgeStatus(job)}</p></div>
      {!job || ["CANCELLED", "EXPIRED", "REJECTED"].includes(job.status) ? <button type="button" disabled={busy || !pairingRequest} onClick={() => void pair()} className="archive-button-primary archive-focus text-xs">{busy ? "Pairing…" : pairingButtonLabel(pairingRequest)}</button>
        : job.status === "READY" && job.preview && job.previewJobId ? <button type="button" onClick={() => onPreview(job.previewJobId!, job.preview!)} className="archive-button-primary archive-focus text-xs">Preview</button>
          : <button type="button" disabled={busy || profile?.phase === "RETRIEVING"} onClick={() => void cancel()} className="rounded border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10">Cancel pairing</button>}
    </div>
    {pairingRequest && (!job || ["CANCELLED", "EXPIRED", "REJECTED"].includes(job.status)) && <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2" aria-live="polite"><p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{pairingRequest.targetKind === "PROFILE" ? "Profile pairing target" : "Character pairing target"}</p><p className="mt-1 break-all text-xs text-zinc-300">{pairingRequest.targetKind === "PROFILE" ? pairingRequest.profileUrl : pairingRequest.characterUrl}</p></div>}
    {job?.target && <p className="mt-2 text-[11px] text-zinc-500">This code is bound to a <span className="font-semibold text-zinc-300">{job.target.targetKind === "PROFILE" ? "Janitor profile" : "Janitor character"}</span>.</p>}
    {pairingCode && job?.status === "WAITING" && <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"><p className="text-xs text-zinc-400">Code</p><p className="mt-1 font-mono text-lg font-semibold tracking-wider text-[color:var(--archive-accent)]">{pairingCode}</p><p className="mt-1 text-xs text-zinc-500">Expires in {expiry}. Enter this one-time code in the companion.</p></div>}

    {profile && <section aria-label="Janitor profile import" className="mt-4 min-w-0 border-t border-zinc-800 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="archive-eyebrow">Janitor profile import</p><h3 className="mt-1 text-base font-semibold text-zinc-100">{profile.items.length} discovered</h3></div>{profile.phase === "RETRIEVING" && <p role="status" className="text-xs text-zinc-400">{progress.ready} ready · {progress.failed} failed · {progress.queued} queued</p>}</div>
      {profile.truncated && <p className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">Showing the first 100 discovered characters.</p>}
      {profile.phase === "DISCOVERED" && <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setDiscoverySelection(new Set(selectableIds))} className="archive-button-secondary archive-focus text-xs">Select all discovered</button><button type="button" onClick={() => setDiscoverySelection(new Set())} className="archive-button-secondary archive-focus text-xs">Deselect all</button><span className="text-xs text-zinc-400">{discoverySelection.size} selected of {profile.items.length}</span><button type="button" disabled={busy || discoverySelection.size === 0} onClick={() => void submitSelection()} className="archive-button-primary archive-focus ml-auto text-xs">Send selection to companion</button></div>}
      {profile.selectedIds.length > 0 && profile.phase !== "REVIEW" && <p className="mt-3 text-xs text-zinc-400">{profile.selectedIds.length} selected. Return to the Companion popup and click <span className="font-semibold text-zinc-200">Retrieve selected</span>.</p>}
      <div className="mt-3 max-h-[28rem] overflow-y-auto overflow-x-hidden rounded-lg border border-zinc-800" role="list">
        {profile.items.map((item) => {
          const discoveryChecked = discoverySelection.has(item.externalId); const expired = item.status === "PREVIEW_READY" && Boolean(item.previewExpiresAt) && new Date(item.previewExpiresAt!).getTime() <= Date.now(); const ready = item.status === "PREVIEW_READY" && item.previewJobId && !expired; const saved = saveResults[item.externalId]?.status === "SAVED"; const visibleStatus: ProfileItemStatus = saved ? "SAVED" : expired ? "PREVIEW_EXPIRED" : item.status;
          return <div key={item.externalId} role="listitem" className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-zinc-800/80 px-3 py-2.5 last:border-b-0"><input aria-label={`Select ${item.name}`} type="checkbox" checked={profile.phase === "DISCOVERED" ? discoveryChecked : ready ? saveSelection.has(item.externalId) : false} disabled={(profile.phase !== "DISCOVERED" && !ready) || saved} onChange={(event) => profile.phase === "DISCOVERED" ? setDiscoverySelection(toggleSet(discoverySelection, item.externalId, event.target.checked)) : setSaveSelection(toggleSet(saveSelection, item.externalId, event.target.checked))} className="archive-focus size-4 accent-pink-500" /><div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-200" title={item.name}>{item.name}</p><p className="truncate text-[11px] text-zinc-500">{item.creatorName ?? "Unknown creator"} · {item.externalId}</p>{saveResults[item.externalId]?.message && <p className="mt-1 text-[11px] text-red-400">{saveResults[item.externalId].message}</p>}</div><div className="flex items-center gap-2"><span className={`rounded px-2 py-1 text-[10px] font-semibold ${statusClass(visibleStatus)}`}>{visibleStatus.replaceAll("_", " ")}</span>{ready && <button type="button" disabled={busy} onClick={() => void reviewItem(item)} className="archive-focus text-xs text-pink-300 hover:text-pink-200">Review</button>}</div></div>;
        })}
      </div>
      {readyItems.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><button type="button" onClick={() => setSaveSelection(new Set(readyItems.filter((item) => saveResults[item.externalId]?.status !== "SAVED").map((item) => item.externalId)))} className="archive-button-secondary archive-focus text-xs">Select all ready</button><button type="button" onClick={() => setSaveSelection(new Set())} className="archive-button-secondary archive-focus text-xs">Deselect all</button><span className="text-xs text-zinc-400">{saveSelection.size} ready selected</span><button type="button" disabled={busy || saveSelection.size === 0} onClick={() => void saveSelected()} className="archive-button-primary archive-focus ml-auto text-xs">{busy ? "Saving…" : `Save selected (${saveSelection.size})`}</button></div>}
    </section>}
    {error && <p role="alert" className="mt-3 text-xs text-red-400">{error}</p>}
  </div>;
}

function bridgeStatus(job: BridgeJob | null): string {
  if (job?.profile?.phase === "REVIEW") return `● ${job.profile.items.filter((item) => item.status === "PREVIEW_READY").length} profile previews ready for review`;
  if (job?.profile?.phase === "RETRIEVING") return "● Profile retrieval in progress — the popup may be closed";
  if (job?.profile?.phase === "DISCOVERED") return `● ${job.profile.items.length} profile characters discovered`;
  if (job?.status === "PAIRED") return "● Companion paired — waiting for Janitor data…";
  if (job?.status === "READY") return `● ${job.preview?.name ?? "Character"} received from Janitor`;
  if (job?.status === "WAITING") return "○ Waiting for Janitor companion…";
  return "○ Not paired";
}
function toggleSet(current: Set<string>, id: string, checked: boolean): Set<string> { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; }
function statusClass(status: ProfileItemStatus): string { return status === "PREVIEW_READY" || status === "SAVED" ? "bg-emerald-500/10 text-emerald-300" : ["FAILED", "INVALID_PAYLOAD", "AUTH_REQUIRED", "NOT_FOUND", "RATE_LIMITED"].includes(status) ? "bg-red-500/10 text-red-300" : "bg-zinc-800 text-zinc-300"; }
function secondsUntil(expiresAt: string): number { return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)); }
function safePairingRequest(sourceUrl: string): BridgePairingRequest | null { try { return bridgePairingRequestForUrl(sourceUrl); } catch { return null; } }
function pairingButtonLabel(request: BridgePairingRequest | null): string { return request?.targetKind === "PROFILE" ? "Pair Profile" : request?.targetKind === "CHARACTER" ? "Pair Character" : "Enter target URL"; }
