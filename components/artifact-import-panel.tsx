"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { ImportPreview } from "@/src/lib/importers/workflow";
import type { FallbackReviewDetail, FallbackReviewSummary } from "@/src/lib/importers/fallback-review";
import {
  ARTIFACT_UPLOAD_LIMIT_LABEL,
  MAX_PNG_BYTES,
  MIB,
  validateArtifactUploadByteLength,
} from "../src/lib/importers/artifacts/limits";
import { showModalWhenClosed } from "./character-library-utils";

export interface ArtifactItem {
  filename: string;
  status: "READY" | "FALLBACK_REVIEW_REQUIRED" | "LOREBOOK_AMBIGUOUS" | "INVALID";
  code?: string;
  message?: string;
  artworkPolicy?: "PREPARED_UPLOADED_ARTWORK" | "UPSTREAM_METADATA_URL" | "EMBEDDED_ARTWORK_NOT_STORED";
  previewJobId?: string;
  expiresAt?: string;
  preview?: ImportPreview;
  fallbackReview?: FallbackReviewSummary;
}

interface ArtifactBatch {
  kind: "PNG" | "ZIP";
  manifest: { present: boolean; exporterVersion: string | null; declaredTotal: number | null; crossCheck: string };
  warnings: string[];
  items: ArtifactItem[];
}

export function artifactBatchCounts(items: ArtifactItem[]): { ready: number; needsAttention: number } {
  const ready = items.filter((item) => item.status === "READY").length;
  return { ready, needsAttention: items.length - ready };
}

export function selectReadyArtifactFilenames(items: ArtifactItem[], saved = new Map<string, string>()): Set<string> {
  return new Set(items.filter((item) => item.status === "READY" && item.previewJobId && !saved.has(item.filename)).map((item) => item.filename));
}

export function applyMappedFallbackItem(
  items: ArtifactItem[],
  filename: string,
  created: { previewJobId: string; expiresAt: string; preview: ImportPreview },
): ArtifactItem[] {
  return items.map((item) => item.filename === filename ? {
    ...item,
    status: "READY",
    code: undefined,
    message: "Reviewed fallback mapping is ready to save.",
    ...created,
  } : item);
}

export function ArtifactImportPanel() {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [batch, setBatch] = useState<ArtifactBatch | null>(null);
  const [batchFilename, setBatchFilename] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Map<string, string>>(new Map());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [reviewing, setReviewing] = useState<{ filename: string; review: FallbackReviewSummary } | null>(null);

  async function inspect(file: File | undefined) {
    if (!file || loading) return;
    setError(null);
    setBatch(null);
    setBatchFilename(file.name);
    setSaved(new Map());
    setSaveErrors(new Map());
    setAttentionOnly(false);
    const sizeError = validateArtifactUploadByteLength(file.size);
    if (sizeError) {
      setError(sizeError);
      return;
    }
    setLoading(true);
    setProgress(`Uploading ${file.name}…`);
    try {
      const { body, status } = await uploadArtifact(file, setProgress);
      if (status < 200 || status >= 300 || !Array.isArray(body.items)) throw new Error(body.error?.message ?? "The artifact could not be inspected.");
      setBatch(body);
      setSelected(selectReadyArtifactFilenames(body.items));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The artifact could not be inspected.");
    } finally {
      setLoading(false);
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  }

  function toggle(filename: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(filename)) next.delete(filename); else next.add(filename);
      return next;
    });
  }

  async function saveSelected() {
    if (!batch || saving) return;
    const candidates = batch.items.filter((item) => selected.has(item.filename) && item.previewJobId && !saved.has(item.filename));
    if (candidates.length === 0) return;
    setSaving(true);
    const nextSaved = new Map(saved);
    const nextErrors = new Map(saveErrors);
    for (const item of candidates) {
      try {
        const response = await fetch("/api/import/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: "artifact-upload", previewJobId: item.previewJobId, linkMode: "CREATE_SEPARATE" }),
        });
        const body = await response.json() as { result?: { characterId: string }; error?: { message?: string; savedCharacterId?: string } };
        const characterId = body.result?.characterId ?? body.error?.savedCharacterId;
        if (!response.ok || !characterId) throw new Error(body.error?.message ?? "Save failed.");
        nextSaved.set(item.filename, characterId);
        nextErrors.delete(item.filename);
      } catch (caught) {
        nextErrors.set(item.filename, caught instanceof Error ? caught.message : "Save failed.");
      }
      setSaved(new Map(nextSaved));
      setSaveErrors(new Map(nextErrors));
    }
    setSaving(false);
  }

  const { ready, needsAttention } = artifactBatchCounts(batch?.items ?? []);
  const selectedUnsaved = batch?.items.filter((item) => selected.has(item.filename) && !saved.has(item.filename)).length ?? 0;
  const visibleItems = batch?.items.filter((item) => !attentionOnly || item.status !== "READY") ?? [];

  function handleMappedFallback(filename: string, created: { previewJobId: string; expiresAt: string; preview: ImportPreview }) {
    setBatch((current) => current ? {
      ...current,
      items: applyMappedFallbackItem(current.items, filename, created),
    } : current);
    setReviewing(null);
  }

  return (
    <section aria-labelledby="artifact-import-heading" className="border-b border-zinc-800 bg-zinc-950/30 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="archive-eyebrow">Production import</p>
          <h1 id="artifact-import-heading" className="mt-1 text-xl font-bold uppercase tracking-[-0.015em] text-zinc-50 sm:text-2xl">Import extractor ZIP or character card</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-400">Inspect locally exported artifacts, review every normalized character, then explicitly save the selected previews.</p>
        </div>
        <span className="archive-chip">Server inspected</span>
      </div>

      <div
        className={`archive-focus mt-4 rounded-xl border border-dashed px-5 py-7 text-center transition ${dragging ? "border-pink-400 bg-pink-500/10" : "border-zinc-700 bg-zinc-950/50 hover:border-zinc-500"}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); void inspect(event.dataTransfer.files[0]); }}
      >
        <input ref={input} id="artifact-file" type="file" accept=".zip,.png,application/zip,image/png" className="sr-only" onChange={(event) => void inspect(event.target.files?.[0])} />
        <p className="text-sm font-semibold text-zinc-100">Drop a ZIP or CCv2 PNG here</p>
        <p className="mt-1 text-xs text-zinc-500">Maximum archive: {ARTIFACT_UPLOAD_LIMIT_LABEL} · Individual Character Card PNG: up to {MAX_PNG_BYTES / MIB} MiB</p>
        <p className="mt-1 text-[0.68rem] text-zinc-600">Archive entries are inspected in memory and are never extracted to filesystem paths.</p>
        <button type="button" disabled={loading} onClick={() => input.current?.click()} className="archive-button-secondary archive-focus mt-4">
          {loading ? "Inspecting…" : "Browse files"}
        </button>
      </div>

      {loading && <p role="status" aria-live="polite" className="mt-3 text-xs text-zinc-400">{progress ?? `Uploading ${batchFilename}…`}</p>}

      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      {batch && (
        <div className="mt-5" aria-live="polite">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="archive-eyebrow">Batch review</p>
              <h2 className="mt-1 text-base font-semibold text-zinc-100">{ready} ready · {needsAttention} need attention</h2>
              <p className="mt-1 text-xs text-zinc-500">
                <span className="inline-block max-w-full truncate align-bottom" title={batchFilename ?? undefined}>{batchFilename}</span>
                <span>{` · ${batch.kind}`}{batch.manifest.present ? ` · extractor ${batch.manifest.exporterVersion} · manifest ${batch.manifest.crossCheck.toLowerCase()}` : " · standalone card"}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={attentionOnly} className="archive-button-secondary archive-focus" onClick={() => setAttentionOnly((value) => !value)}>{attentionOnly ? "Show all" : `Needs attention (${needsAttention})`}</button>
              <button type="button" className="archive-button-secondary archive-focus" onClick={() => setSelected(selectReadyArtifactFilenames(batch.items, saved))}>Select ready</button>
              <button type="button" className="archive-button-secondary archive-focus" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          </div>

          {batch.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-amber-200">{warning}</p>)}
          <div className="mt-3 max-h-[72vh] space-y-2 overflow-y-auto pr-1 lg:max-h-[54rem]">
            {visibleItems.map((item) => {
              const canSelect = item.status === "READY" && Boolean(item.previewJobId) && !saved.has(item.filename);
              const duplicateCount = item.preview?.duplicateAnalysis?.candidates?.length ?? 0;
              const title = item.preview?.name ?? item.fallbackReview?.displayName ?? item.filename;
              const itemArtwork = item.preview?.artwork ?? item.fallbackReview?.artwork;
              return (
                <article key={item.filename} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" className="mt-1 h-4 w-4 accent-pink-500" checked={selected.has(item.filename) && canSelect} disabled={!canSelect} onChange={() => toggle(item.filename)} aria-label={`Select ${title}`} />
                    {itemArtwork && (
                      <Image
                        unoptimized
                        src={itemArtwork.url}
                        alt=""
                        width={itemArtwork.width}
                        height={itemArtwork.height}
                        className="h-20 w-14 shrink-0 rounded-md border border-zinc-800 object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-zinc-100">{title}</h3>
                        <StatusPill status={saved.has(item.filename) ? "SAVED" : item.status} />
                        {item.preview && <span className="archive-chip">{item.preview.platform}</span>}
                      </div>
                      <p className="mt-1 text-[0.68rem] text-zinc-500">
                        {item.fallbackReview ? `TXT fallback · export #${String(item.fallbackReview.exportIndex).padStart(3, "0")} · ${item.fallbackReview.sourcePlatform}` : item.preview ? `${item.preview.platform} character card` : "Artifact needs attention"}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[0.62rem] text-zinc-700" title={item.filename}>{item.filename}</p>
                      {item.preview && (
                        <>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                            <span>{item.preview.tags.length} tags</span><span>{item.preview.greetings.length} greetings</span><span>{item.preview.lorebookReferences.length} lorebooks</span><span>{duplicateCount} duplicate signals</span>
                          </div>
                          <details className="mt-2 rounded border border-zinc-800/80 bg-black/20 px-3 py-2">
                            <summary className="archive-focus cursor-pointer text-xs font-semibold text-zinc-300">Inspect normalized record</summary>
                            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                              <ReviewField label="Source identity" value={`${item.preview.platform} · ${item.preview.externalId}`} />
                              <ReviewField label="Creator" value={item.preview.creator.name ?? "Unavailable"} />
                              <ReviewField label="Description" value={item.preview.description ?? "Unavailable"} wide />
                              <ReviewField label="Personality" value={item.preview.personality ?? "Unavailable"} wide />
                              <ReviewField label="Scenario" value={item.preview.scenario ?? "Unavailable"} wide />
                              <ReviewField label="Tags" value={item.preview.tags.map((tag) => tag.name).join(", ") || "None"} wide />
                              <ReviewField label="Greetings" value={item.preview.greetings.map((greeting) => greeting.content).join("\n\n") || "None"} wide />
                              <ReviewField label="Lorebooks" value={item.preview.lorebookReferences.map((book) => book.title).join(", ") || "None"} wide />
                            </dl>
                          </details>
                        </>
                      )}
                      {item.message && <p className="mt-2 text-xs text-amber-200">{item.message}</p>}
                      {item.fallbackReview && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {item.fallbackReview.definitionHidden && <span className="archive-chip">Source definition was hidden</span>}
                          <button type="button" className="archive-button-secondary archive-focus" onClick={(event) => { event.currentTarget.dataset.reviewOrigin = "true"; setReviewing({ filename: item.filename, review: item.fallbackReview! }); }}>
                            {item.status === "READY" ? "Edit mapping" : "Review & map"}
                          </button>
                        </div>
                      )}
                      {item.artworkPolicy === "PREPARED_UPLOADED_ARTWORK" && <p className="mt-1 text-[0.68rem] text-emerald-300">Artwork PNG attached · retained only after Save.</p>}
                      {item.artworkPolicy === "EMBEDDED_ARTWORK_NOT_STORED" && <p className="mt-1 text-[0.68rem] text-zinc-500">No validated artwork PNG is attached.</p>}
                      {saveErrors.get(item.filename) && <p role="alert" className="mt-2 text-xs text-red-300">{saveErrors.get(item.filename)}</p>}
                      {saved.get(item.filename) && <a href={`/characters/${saved.get(item.filename)}`} className="archive-link mt-2 inline-block text-xs">Open saved character</a>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-4">
            <p className="text-xs text-zinc-500">{selectedUnsaved} selected. Save uses the exact reviewed server snapshot; the artifact is not read again.</p>
            <button type="button" disabled={saving || selectedUnsaved === 0} onClick={() => void saveSelected()} className="archive-button-primary archive-focus">
              {saving ? "Saving selected…" : `Save selected (${selectedUnsaved})`}
            </button>
          </div>
        </div>
      )}

      {reviewing && (
        <FallbackReviewDialog
          filename={reviewing.filename}
          summary={reviewing.review}
          onClose={() => setReviewing(null)}
          onCreated={(created) => handleMappedFallback(reviewing.filename, created)}
        />
      )}
    </section>
  );
}

interface FallbackFormState {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  firstGreeting: string;
  exampleDialogs: string;
  tags: string;
}

export function FallbackReviewDialog({
  filename,
  summary,
  onClose,
  onCreated,
  initialDetail,
}: {
  filename: string;
  summary: FallbackReviewSummary;
  onClose: () => void;
  onCreated: (created: { previewJobId: string; expiresAt: string; preview: ImportPreview }) => void;
  initialDetail?: FallbackReviewDetail;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<FallbackReviewDetail | null>(initialDetail ?? null);
  const [form, setForm] = useState<FallbackFormState | null>(() => initialDetail ? fallbackFormFromDetail(initialDetail) : null);
  const [loading, setLoading] = useState(!initialDetail);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.documentElement.style.overflow;
    showModalWhenClosed(dialog);
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previousOverflow;
      const origin = document.querySelector<HTMLElement>("[data-review-origin='true']");
      origin?.removeAttribute("data-review-origin");
      origin?.focus();
    };
  }, []);

  useEffect(() => {
    if (initialDetail) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/import/artifacts/reviews/${encodeURIComponent(summary.reviewId)}`, { signal: controller.signal });
        const body = await response.json() as FallbackReviewDetail & { error?: { message?: string } };
        if (!response.ok) throw new Error(body.error?.message ?? "Fallback review could not be loaded.");
        setDetail(body);
        setForm(fallbackFormFromDetail(body));
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Fallback review could not be loaded.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [initialDetail, summary.reviewId]);

  function close() {
    dialogRef.current?.close();
  }

  function setField(field: keyof FallbackFormState, value: string) {
    setForm((current) => current ? { ...current, [field]: value } : current);
  }

  async function createPreview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || !detail || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/import/artifacts/reviews/${encodeURIComponent(summary.reviewId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          personality: form.personality,
          scenario: form.scenario,
          firstGreeting: form.firstGreeting,
          alternateGreetings: detail.prefill.alternateGreetings,
          exampleDialogs: form.exampleDialogs,
          tags: form.tags.split("\n").map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      const body = await response.json() as { previewJobId?: string; expiresAt?: string; preview?: ImportPreview; error?: { message?: string } };
      if (!response.ok || !body.previewJobId || !body.expiresAt || !body.preview) throw new Error(body.error?.message ?? "The reviewed preview could not be created.");
      onCreated({ previewJobId: body.previewJobId, expiresAt: body.expiresAt, preview: body.preview });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The reviewed preview could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="fallback-review-title"
      onClose={onClose}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
      className="m-auto max-h-[92vh] w-[min(58rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/80"
    >
      <div className="flex max-h-[92vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="archive-eyebrow">Fallback character review</p>
            <h2 id="fallback-review-title" className="mt-1 truncate text-lg font-semibold text-zinc-50 sm:text-xl">{summary.displayName}</h2>
            <p className="mt-1 text-xs text-zinc-500">TXT fallback · export #{String(summary.exportIndex).padStart(3, "0")} · {summary.sourcePlatform}</p>
          </div>
          <button type="button" aria-label="Close fallback review" onClick={close} className="archive-focus rounded p-2 text-xl text-zinc-400 hover:text-white">×</button>
        </header>

        <div className="overflow-y-auto px-4 py-4 sm:px-6">
          {loading && <p role="status" className="text-sm text-zinc-400">Loading supplied fallback artifacts…</p>}
          {error && <p role="alert" className="mb-4 text-sm text-red-300">{error}</p>}
          {detail && form && (
            <form id="fallback-review-form" onSubmit={(event) => void createPreview(event)} className="space-y-5">
              <section>
                <h3 className="archive-eyebrow">Source artifacts</h3>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className="archive-chip">✓ TXT fallback</span>
                  <span className="archive-chip">{detail.artifacts.png ? "✓" : "—"} Artwork PNG</span>
                  <span className="archive-chip">{detail.artifacts.worldInfoFiles > 0 ? "✓" : "—"} World Info JSON</span>
                  {detail.definitionHidden && <span className="archive-chip">Source definition was hidden</span>}
                </div>
                {summary.artwork && (
                  <Image
                    unoptimized
                    src={summary.artwork.url}
                    alt="Prepared character artwork"
                    width={summary.artwork.width}
                    height={summary.artwork.height}
                    className="mt-3 h-auto max-h-80 w-full rounded-lg border border-zinc-800 object-contain"
                  />
                )}
                <p className="mt-2 break-all font-mono text-[0.65rem] text-zinc-700">{filename}</p>
              </section>

              <section className="rounded-lg border border-zinc-800 bg-black/20 p-3">
                <h3 className="archive-eyebrow">Partial metadata</h3>
                <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
                  <ReviewField label="Name" value={detail.prefill.name} />
                  <ReviewField label="Creator" value={detail.creatorName ?? "Unavailable"} />
                  <ReviewField label="Source" value={detail.sourcePlatform} />
                  <ReviewField label="Tags" value={detail.prefill.tags.join(", ") || "None"} />
                </dl>
              </section>

              <section>
                <h3 className="archive-eyebrow">Supplied fallback text</h3>
                <p className="mt-1 text-xs text-zinc-500">Read-only reference. Unlabeled prose is never mapped automatically.</p>
                <div className="mt-2 space-y-2">
                  {detail.referenceSections.length === 0 && <p className="text-xs text-zinc-500">No reconstructed text section was supplied.</p>}
                  {detail.referenceSections.map((section, index) => (
                    <details key={`${section.title}-${index}`} className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2">
                      <summary className="archive-focus cursor-pointer text-xs font-semibold text-zinc-300">{section.title}</summary>
                      <pre className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans text-xs leading-5 text-zinc-400">{section.content}</pre>
                    </details>
                  ))}
                </div>
              </section>

              <fieldset className="grid gap-4 sm:grid-cols-2">
                <legend className="archive-eyebrow mb-3">Canonical character fields</legend>
                <FallbackInput label="Name" value={form.name} onChange={(value) => setField("name", value)} required maxLength={300} />
                <FallbackTextarea label="Description" value={form.description} onChange={(value) => setField("description", value)} />
                <FallbackTextarea label="Personality" value={form.personality} onChange={(value) => setField("personality", value)} />
                <FallbackTextarea label="Scenario" value={form.scenario} onChange={(value) => setField("scenario", value)} />
                <FallbackTextarea label="First greeting" value={form.firstGreeting} onChange={(value) => setField("firstGreeting", value)} />
                <FallbackTextarea label="Example dialogue" value={form.exampleDialogs} onChange={(value) => setField("exampleDialogs", value)} />
                <FallbackTextarea label="Tags (one per line)" value={form.tags} onChange={(value) => setField("tags", value)} maxLength={100_000} />
              </fieldset>

              <section>
                <h3 className="archive-eyebrow">Lorebooks</h3>
                {detail.lorebooks.length === 0 ? <p className="mt-2 text-xs text-zinc-500">No deterministically associated World Info file.</p> : (
                  <div className="mt-2 space-y-2">
                    {detail.lorebooks.map((book) => (
                      <details key={book.title} className="rounded-lg border border-zinc-800 bg-black/20 px-3 py-2">
                        <summary className="archive-focus cursor-pointer text-xs font-semibold text-zinc-300">{book.title} · {book.entryCount} entries</summary>
                        <div className="mt-3 space-y-2">
                          {book.entries.map((entry) => <div key={entry.id} className="text-xs text-zinc-400"><span className="font-mono text-zinc-600">{entry.id}</span>{entry.keys.length > 0 && <span> · {entry.keys.join(", ")}</span>}<p className="mt-1 whitespace-pre-wrap break-words">{entry.preview}</p></div>)}
                          {book.entryCount > book.entries.length && <p className="text-xs text-zinc-600">+{book.entryCount - book.entries.length} more entries</p>}
                        </div>
                      </details>
                    ))}
                  </div>
                )}
              </section>
            </form>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-800 bg-zinc-950 px-4 py-3 sm:px-6">
          <button type="button" onClick={close} className="archive-button-secondary archive-focus">Cancel</button>
          <button type="submit" form="fallback-review-form" disabled={!form || submitting} className="archive-button-primary archive-focus">{submitting ? "Creating preview…" : "Create preview"}</button>
        </footer>
      </div>
    </dialog>
  );
}

function fallbackFormFromDetail(detail: FallbackReviewDetail): FallbackFormState {
  return {
    name: detail.prefill.name,
    description: detail.prefill.description ?? "",
    personality: detail.prefill.personality ?? "",
    scenario: detail.prefill.scenario ?? "",
    firstGreeting: detail.prefill.firstGreeting,
    exampleDialogs: detail.prefill.exampleDialogs ?? "",
    tags: detail.prefill.tags.join("\n"),
  };
}

function FallbackInput({ label, value, onChange, required, maxLength }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; maxLength: number }) {
  return <label className="block text-xs font-semibold text-zinc-400">{label}<input value={value} required={required} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="archive-focus mt-1 w-full rounded border border-zinc-700 bg-black/40 px-3 py-2 text-sm text-zinc-100" /></label>;
}

function FallbackTextarea({ label, value, onChange, maxLength = 1_000_000 }: { label: string; value: string; onChange: (value: string) => void; maxLength?: number }) {
  return <label className="block text-xs font-semibold text-zinc-400">{label}<textarea value={value} maxLength={maxLength} rows={5} onChange={(event) => onChange(event.target.value)} className="archive-focus mt-1 w-full resize-y rounded border border-zinc-700 bg-black/40 px-3 py-2 text-sm leading-5 text-zinc-100" /></label>;
}

interface ArtifactUploadResponse extends ArtifactBatch {
  error?: { message?: string };
}

function uploadArtifact(file: File, onProgress: (message: string) => void): Promise<{ body: ArtifactUploadResponse; status: number }> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/import/artifacts");
    request.timeout = 300_000;
    request.responseType = "json";
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-Artifact-Filename", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(`Uploading ${file.name}… ${Math.min(100, Math.round((event.loaded / event.total) * 100))}%`);
    };
    request.upload.onload = () => onProgress("Inspecting archive… Discovering characters… Creating previews…");
    request.onerror = () => reject(new Error("The artifact upload could not reach the server."));
    request.onabort = () => reject(new Error("The artifact upload was cancelled."));
    request.ontimeout = () => reject(new Error("The artifact upload exceeded the 5-minute processing limit."));
    request.onload = () => {
      const body: ArtifactUploadResponse = request.response && typeof request.response === "object"
        ? request.response as ArtifactUploadResponse
        : { kind: "ZIP", manifest: { present: false, exporterVersion: null, declaredTotal: null, crossCheck: "NOT_APPLICABLE" as const }, warnings: [], items: [], error: { message: "The server returned an invalid artifact response." } };
      resolve({ body, status: request.status });
    };
    request.send(file);
  });
}

function StatusPill({ status }: { status: ArtifactItem["status"] | "SAVED" }) {
  const tone = status === "READY" ? "border-emerald-700/70 text-emerald-300" : status === "SAVED" ? "border-sky-700/70 text-sky-300" : status === "INVALID" ? "border-red-800 text-red-300" : "border-amber-700/70 text-amber-200";
  return <span className={`rounded border px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase tracking-[0.08em] ${tone}`}>{status.replaceAll("_", " ")}</span>;
}

function ReviewField({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="font-semibold uppercase tracking-[0.06em] text-zinc-600">{label}</dt>
      <dd className="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap break-words leading-5 text-zinc-300">{value}</dd>
    </div>
  );
}
