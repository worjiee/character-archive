"use client";

import Link from "next/link";
import { useState } from "react";
import type { ImportPreview } from "@/src/lib/importers/workflow";
import type { PersistNormalizedCharacterResult } from "@/src/lib/importers/persistence";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";

interface ImportWorkflowProps {
  automaticFixtureEnabled: boolean;
  initialUrl: string;
}

interface ApiErrorBody { error?: { code?: string; message?: string }; }
type ImportMethod = "automatic-url" | "manual-json";

export function ImportWorkflow({ automaticFixtureEnabled, initialUrl }: ImportWorkflowProps) {
  const [automaticUrl, setAutomaticUrl] = useState(initialUrl);
  const [manualUrl, setManualUrl] = useState(initialUrl);
  const [sourceJson, setSourceJson] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewedUrl, setPreviewedUrl] = useState<string | null>(null);
  const [previewedSourceJson, setPreviewedSourceJson] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<ImportMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCharacterId, setSavedCharacterId] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<PersistNormalizedCharacterResult | null>(null);

  function resetResult() {
    setPreview(null);
    setPreviewedUrl(null);
    setPreviewedSourceJson(null);
    setSavedCharacterId(null);
    setSaveResult(null);
  }

  async function requestPreview(method: ImportMethod) {
    if (loading) return;
    const selectedUrl = method === "manual-json" ? manualUrl.trim() : automaticUrl.trim();
    setLoading(method);
    setError(null);
    resetResult();
    try {
      const payload = method === "manual-json"
        ? { method, url: selectedUrl, sourceJson }
        : { method, url: selectedUrl };
      const response = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as { preview?: ImportPreview } & ApiErrorBody;
      if (!response.ok || !body.preview) {
        throw new Error(body.error?.message ?? "The character preview could not be created.");
      }
      setPreview(body.preview);
      setPreviewedUrl(selectedUrl);
      setPreviewedSourceJson(method === "manual-json" ? sourceJson : null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(null);
    }
  }

  async function handleSave() {
    if (!previewedUrl || !preview || saving || savedCharacterId) return;
    setSaving(true);
    setError(null);
    try {
      const method: ImportMethod = preview.provider === "manual-json" ? "manual-json" : "automatic-url";
      const response = await fetch("/api/import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          url: previewedUrl,
          ...(method === "manual-json" ? { sourceJson: previewedSourceJson } : {}),
        }),
      });
      const body = await response.json() as { result?: PersistNormalizedCharacterResult } & ApiErrorBody;
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "The character could not be saved.");
      setSavedCharacterId(body.result.characterId);
      setSaveResult(body.result);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function loadJsonFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    resetResult();
    if (file.size > MAX_MANUAL_JSON_UPLOAD_BYTES) {
      setError("The selected JSON file is too large. Character JSON is limited to 1 MB.");
      return;
    }
    try {
      setSourceJson(await file.text());
    } catch {
      setError("The selected JSON file could not be read.");
    }
  }

  return (
    <div>
      <div className="border-b border-zinc-800/80 pb-6">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Add to library</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-3xl">Import a character</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Review one Janitor AI character response, then save it through the repository&apos;s normal moderation and persistence pipeline.</p>
      </div>

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-2">
        <section className="archive-surface rounded-xl border p-4 sm:p-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">Automatic URL import</p>
          <h2 className="mt-2 text-base font-semibold text-zinc-100">Janitor character URL</h2>
          <p className="mt-1 text-xs leading-5 text-amber-300">Automatic source retrieval is currently under development.</p>
          {automaticFixtureEnabled && <p className="mt-2 text-xs leading-5 text-zinc-500">Development only: the included Theron URL uses a local fixture and does not contact Janitor AI.</p>}
          <form onSubmit={(event) => { event.preventDefault(); void requestPreview("automatic-url"); }} className="mt-4">
            <label htmlFor="automatic-janitor-url" className="text-xs font-medium text-zinc-300">Janitor AI character URL</label>
            <input id="automatic-janitor-url" type="url" required value={automaticUrl} onChange={(event) => { setAutomaticUrl(event.target.value); resetResult(); }} className={inputClass} placeholder="https://janitorai.com/characters/..." />
            <button type="submit" disabled={!automaticFixtureEnabled || loading !== null} className={`${primaryButton} mt-3`}>{loading === "automatic-url" ? "Creating preview…" : "Preview"}</button>
          </form>
        </section>

        <section className="archive-surface rounded-xl border p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-400">Manual character data</p><h2 className="mt-2 text-base font-semibold text-zinc-100">Janitor Character JSON</h2></div><span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-zinc-500">Owner tool</span></div>
          <p className="mt-2 text-xs leading-5 text-zinc-400">Paste the structured character response only. Do not paste cookies, authorization headers, tokens, HAR files, or browser storage.</p>
          <form onSubmit={(event) => { event.preventDefault(); void requestPreview("manual-json"); }} className="mt-4 grid gap-4">
            <label className="block"><span className="text-xs font-medium text-zinc-300">Original Janitor character URL</span><input type="url" required value={manualUrl} onChange={(event) => { setManualUrl(event.target.value); resetResult(); }} className={inputClass} placeholder="https://janitorai.com/characters/..." /></label>
            <label className="block"><span className="text-xs font-medium text-zinc-300">Paste JSON</span><textarea required rows={10} value={sourceJson} onChange={(event) => { setSourceJson(event.target.value); resetResult(); }} className={`${inputClass} resize-y font-mono text-xs leading-5`} placeholder={'{\n  "id": "…",\n  "name": "…"\n}'} /></label>
            <label className="block rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-xs text-zinc-500"><span className="block font-medium text-zinc-300">Or upload a .json file</span><input type="file" accept="application/json,.json" onChange={(event) => void loadJsonFile(event.target.files?.[0])} className="mt-2 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-300" /></label>
            <button type="submit" disabled={loading !== null} className={primaryButton}>{loading === "manual-json" ? "Validating…" : "Preview Character"}</button>
          </form>
        </section>
      </div>

      {error && <div role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {preview && <CharacterPreview preview={preview} savedCharacterId={savedCharacterId} saveResult={saveResult} saving={saving} onSave={handleSave} />}
    </div>
  );
}

function CharacterPreview({ preview, savedCharacterId, saveResult, saving, onSave }: { preview: ImportPreview; savedCharacterId: string | null; saveResult: PersistNormalizedCharacterResult | null; saving: boolean; onSave: () => Promise<void> }) {
  return (
    <section aria-labelledby="preview-heading" className="archive-surface mt-5 overflow-hidden rounded-xl border">
      <div className="grid gap-6 p-4 sm:p-5 md:grid-cols-[190px_1fr]">
        <CharacterAvatar name={preview.name} src={preview.avatarUrl} className="aspect-[3/4] w-full max-w-[220px] rounded-xl" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><SourceBadge platform={preview.platform} /><span className={preview.provider === "manual-json" ? "rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300" : "rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-200"}>{preview.provider === "manual-json" ? "Manual JSON" : "Development fixture"}</span></div>
          <h2 id="preview-heading" className="mt-4 text-2xl font-semibold text-zinc-50">{preview.name}</h2>
          <p className="mt-1 text-sm text-zinc-400">by {preview.creator.name ?? "Unknown creator"}</p>
          <a href={preview.sourceUrl} target="_blank" rel="noreferrer" title={preview.sourceUrl} className="archive-focus mt-2 block max-w-2xl truncate text-xs text-violet-400 hover:text-violet-300">{preview.sourceUrl}</a>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{preview.description ?? "No description provided."}</p>
          <div className="mt-5 flex flex-wrap gap-2">{preview.tags.map((tag) => <span key={tag.slug} className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">{tag.name}</span>)}{preview.tags.length === 0 && <span className="text-xs text-zinc-500">No tags</span>}</div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3"><dt className="text-zinc-500">Greetings</dt><dd className="mt-1 font-medium text-zinc-200">{preview.greetings.length}</dd></div><div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3"><dt className="text-zinc-500">Lorebook references</dt><dd className="mt-1 font-medium text-zinc-200">{preview.lorebookReferences.length}</dd></div></dl>
        </div>
      </div>
      <div className="border-t border-zinc-800 px-5 py-4 md:px-6">
        <PreviewDetails title="Personality" empty="No personality provided." hasContent={Boolean(preview.personality)}><p>{preview.personality}</p></PreviewDetails>
        <PreviewDetails title="Scenario" empty="No scenario provided." hasContent={Boolean(preview.scenario)}><p>{preview.scenario}</p></PreviewDetails>
        <PreviewDetails title={`Greetings (${preview.greetings.length})`} empty="No greetings provided." hasContent={preview.greetings.length > 0}><ol className="space-y-3">{preview.greetings.map((greeting) => <li key={`${greeting.position}-${greeting.content}`} className="rounded-lg bg-zinc-950/55 p-3"><span className="mr-2 text-xs font-semibold text-violet-400">{greeting.position + 1}</span>{greeting.content}</li>)}</ol></PreviewDetails>
        <PreviewDetails title={`Lorebook references (${preview.lorebookReferences.length})`} empty="No lorebook references provided." hasContent={preview.lorebookReferences.length > 0}><ul className="space-y-2">{preview.lorebookReferences.map((reference) => <li key={reference.externalId}>{reference.title} <span className="text-xs text-zinc-600">Reference only · content not retrieved</span></li>)}</ul></PreviewDetails>
      </div>
      <div className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-950/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
        {savedCharacterId ? <div role="status" className={saveResult?.status === "QUARANTINED" ? "text-sm text-amber-300" : "text-sm text-emerald-300"}>{saveResult?.status === "QUARANTINED" ? <><p className="font-semibold">Saved to quarantine.</p><p className="mt-1 text-xs text-amber-200/80">{saveResult.blockedReason ?? "Matched an enabled blocklist entry."}</p></> : <p>Saved successfully. Re-importing this source updates the same record.</p>}</div> : <p className="text-xs text-zinc-500">Save revalidates this source payload server-side, then runs moderation and transactional persistence.</p>}
        {savedCharacterId ? <Link href={`/characters/${savedCharacterId}`} className={`archive-focus rounded-lg px-4 py-2.5 text-center text-xs font-semibold ${saveResult?.status === "QUARANTINED" ? "bg-amber-400 text-zinc-950 hover:bg-amber-300" : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"}`}>{saveResult?.status === "QUARANTINED" ? "Review quarantined character" : "View saved character"}</Link> : <button type="button" onClick={() => void onSave()} disabled={saving} className={primaryButton}>{saving ? "Saving…" : "Save to Library"}</button>}
      </div>
    </section>
  );
}

function PreviewDetails({ title, empty, hasContent, children }: { title: string; empty: string; hasContent: boolean; children: React.ReactNode }) {
  return <details className="group border-b border-zinc-800 py-3 last:border-b-0"><summary className="archive-focus cursor-pointer list-none rounded text-sm font-medium text-zinc-200 marker:hidden">{title}<span className="float-right text-zinc-500 transition group-open:rotate-45">＋</span></summary><div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{hasContent ? children : empty}</div></details>;
}

function getErrorMessage(value: unknown): string { return value instanceof Error ? value.message : "An unexpected error occurred."; }

const inputClass = "mt-2 w-full min-w-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20";
const primaryButton = "archive-focus accent-solid rounded-lg px-4 py-2.5 text-xs font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55";
const MAX_MANUAL_JSON_UPLOAD_BYTES = 1024 * 1024;
