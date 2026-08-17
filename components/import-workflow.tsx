"use client";

import Link from "next/link";
import { useState } from "react";
import type { ImportPreview } from "@/src/lib/importers/workflow";
import type { PersistNormalizedCharacterResult } from "@/src/lib/importers/persistence";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";

interface ImportWorkflowProps { initialUrl: string; }
interface ApiErrorBody { error?: { code?: string; message?: string }; }

export function ImportWorkflow({ initialUrl }: ImportWorkflowProps) {
  const [url, setUrl] = useState(initialUrl);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewedUrl, setPreviewedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCharacterId, setSavedCharacterId] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<PersistNormalizedCharacterResult | null>(null);

  async function handlePreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setError(null); setPreview(null); setPreviewedUrl(null); setSavedCharacterId(null); setSaveResult(null);
    try {
      const response = await fetch("/api/import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await response.json() as { preview?: ImportPreview } & ApiErrorBody;
      if (!response.ok || !body.preview) throw new Error(body.error?.message ?? "The character preview could not be created.");
      setPreview(body.preview); setPreviewedUrl(url.trim());
    } catch (caught) { setError(getErrorMessage(caught)); }
    finally { setLoading(false); }
  }

  async function handleSave() {
    if (!previewedUrl || saving || savedCharacterId) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/import/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: previewedUrl }) });
      const body = await response.json() as { result?: PersistNormalizedCharacterResult } & ApiErrorBody;
      if (!response.ok || !body.result) throw new Error(body.error?.message ?? "The character could not be saved.");
      setSavedCharacterId(body.result.characterId); setSaveResult(body.result);
    } catch (caught) { setError(getErrorMessage(caught)); }
    finally { setSaving(false); }
  }

  return (
    <div>
      <div className="border-b border-zinc-800/80 pb-6"><p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-400">Add to library</p><h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-3xl">Import a character</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">Validate one Janitor AI character URL, review its normalized data, then save it to your private archive.</p></div>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/8 px-4 py-3 text-xs leading-5 text-amber-200"><span aria-hidden="true" className="mt-0.5">◇</span><p><span className="font-semibold">Development fixture preview.</span> This flow uses the local Theron fixture and does not contact Janitor AI.</p></div>
      <form onSubmit={handlePreview} className="archive-surface mt-4 rounded-xl border p-4 sm:p-5">
        <label htmlFor="janitor-url" className="text-xs font-medium text-zinc-200">Janitor AI character URL</label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input id="janitor-url" type="url" required value={url} onChange={(event) => { setUrl(event.target.value); setSavedCharacterId(null); }} aria-describedby="janitor-url-help" className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20" placeholder="https://janitorai.com/characters/..." />
          <button type="submit" disabled={loading} className="archive-focus accent-solid rounded-lg px-4 py-2.5 text-xs font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55">{loading ? "Creating preview…" : "Preview character"}</button>
        </div>
        <p id="janitor-url-help" className="mt-2 text-xs text-zinc-500">Only the included Theron URL has a fixture in this phase.</p>
      </form>
      {error && <div role="alert" className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}
      {preview && (
        <section aria-labelledby="preview-heading" className="archive-surface mt-5 overflow-hidden rounded-xl border">
          <div className="grid gap-6 p-4 sm:p-5 md:grid-cols-[190px_1fr]">
            <CharacterAvatar name={preview.name} src={preview.avatarUrl} className="aspect-[3/4] w-full max-w-[220px] rounded-xl" />
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><SourceBadge platform={preview.platform} /><span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-200">Development fixture</span></div><h2 id="preview-heading" className="mt-4 text-2xl font-semibold text-zinc-50">{preview.name}</h2><p className="mt-1 text-sm text-zinc-400">by {preview.creator.name ?? "Unknown creator"}</p><p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-300">{preview.description ?? "No description provided."}</p>
              <div className="mt-5 flex flex-wrap gap-2">{preview.tags.map((tag) => <span key={tag.slug} className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300">{tag.name}</span>)}{preview.tags.length === 0 && <span className="text-xs text-zinc-500">No tags</span>}</div>
              <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3"><dt className="text-zinc-500">Greetings</dt><dd className="mt-1 font-medium text-zinc-200">{preview.greetings.length}</dd></div><div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3"><dt className="text-zinc-500">Lorebook references</dt><dd className="mt-1 font-medium text-zinc-200">{preview.lorebookReferences.length}</dd></div></dl>
            </div>
          </div>
          <div className="border-t border-zinc-800 px-5 py-4 md:px-6">
            <PreviewDetails title="Personality" empty="No personality provided." hasContent={Boolean(preview.personality)}><p>{preview.personality}</p></PreviewDetails>
            <PreviewDetails title="Scenario" empty="No scenario provided." hasContent={Boolean(preview.scenario)}><p>{preview.scenario}</p></PreviewDetails>
            <PreviewDetails title={`Greetings (${preview.greetings.length})`} empty="No greetings provided." hasContent={preview.greetings.length > 0}><ol className="space-y-3">{preview.greetings.map((greeting) => <li key={`${greeting.position}-${greeting.content}`} className="rounded-lg bg-zinc-950/55 p-3"><span className="mr-2 text-xs font-semibold text-violet-400">{greeting.position + 1}</span>{greeting.content}</li>)}</ol></PreviewDetails>
            <PreviewDetails title={`Lorebook references (${preview.lorebookReferences.length})`} empty="No lorebook references provided." hasContent={preview.lorebookReferences.length > 0}><ul className="space-y-2">{preview.lorebookReferences.map((reference) => <li key={reference.externalId}>{reference.title}</li>)}</ul></PreviewDetails>
          </div>
          <div className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-950/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
            {savedCharacterId ? <div role="status" className={saveResult?.status === "QUARANTINED" ? "text-sm text-amber-300" : "text-sm text-emerald-300"}>{saveResult?.status === "QUARANTINED" ? <><p className="font-semibold">Saved to quarantine.</p><p className="mt-1 text-xs text-amber-200/80">{saveResult.blockedReason ?? "Matched an enabled blocklist entry."}</p></> : <p>Saved successfully. Re-importing this source updates the same record.</p>}</div> : <p className="text-xs text-zinc-500">Saving is transactional and safe to retry.</p>}
            {savedCharacterId ? <Link href={`/characters/${savedCharacterId}`} className={`archive-focus rounded-lg px-4 py-2.5 text-center text-xs font-semibold ${saveResult?.status === "QUARANTINED" ? "bg-amber-400 text-zinc-950 hover:bg-amber-300" : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"}`}>{saveResult?.status === "QUARANTINED" ? "Review quarantined character" : "View saved character"}</Link> : <button type="button" onClick={handleSave} disabled={saving} className="archive-focus accent-solid rounded-lg px-4 py-2.5 text-xs font-semibold transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55">{saving ? "Saving…" : "Save to repository"}</button>}
          </div>
        </section>
      )}
    </div>
  );
}

function PreviewDetails({ title, empty, hasContent, children }: { title: string; empty: string; hasContent: boolean; children: React.ReactNode }) {
  return <details className="group border-b border-zinc-800 py-3 last:border-b-0"><summary className="cursor-pointer list-none text-sm font-medium text-zinc-200 marker:hidden">{title}<span className="float-right text-zinc-500 transition group-open:rotate-45">+</span></summary><div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">{hasContent ? children : empty}</div></details>;
}

function getErrorMessage(value: unknown): string { return value instanceof Error ? value.message : "An unexpected error occurred."; }
