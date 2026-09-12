"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  analyzeBulkCharacterUrls,
  BULK_CHARACTER_URL_LIMIT,
  type BulkCharacterUrlAnalysis,
} from "../src/lib/importers/source-url";
import type { SourcePlatformIdentity, SourceSupportState } from "../src/lib/importers/retrieval";
import { getSourceIdentity } from "../src/lib/sources/presentation";
import { SourceBadge } from "./character-badges";
import {
  bridgePairingRequestForUrl,
  type BridgePairingRequest,
} from "../src/lib/bridge/target";

export type RetrievalMode = "single" | "bulk";

export interface ImportModeDraftState {
  mode: RetrievalMode;
  singleUrl: string;
  bulkInput: string;
}

export function switchImportMode(state: ImportModeDraftState, mode: RetrievalMode): ImportModeDraftState {
  return { ...state, mode };
}

export function ImportRetrievalPanel({
  singleUrl,
  onSingleUrlChange,
  loading,
  error,
  onRetrieveSingle,
  detectedProvider = null,
  supportState = null,
  initialMode = "single",
}: {
  singleUrl: string;
  onSingleUrlChange: (value: string) => void;
  loading: boolean;
  error: string | null;
  onRetrieveSingle: () => void;
  detectedProvider?: SourcePlatformIdentity | null;
  supportState?: SourceSupportState | null;
  initialMode?: RetrievalMode;
}) {
  const [mode, setMode] = useState<RetrievalMode>(initialMode);
  const [bulkInput, setBulkInput] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(() => new Set());
  const [singleValidation, setSingleValidation] = useState<string | null>(null);
  const bridgePairingRequest = useMemo(() => safeBridgePairingRequest(singleUrl), [singleUrl]);
  const bulk = useMemo(() => analyzeBulkCharacterUrls(bulkInput), [bulkInput]);

  function chooseMode(nextMode: RetrievalMode) {
    setMode(nextMode);
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, current: RetrievalMode) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextMode = current === "single" ? "bulk" : "single";
    chooseMode(nextMode);
    window.requestAnimationFrame(() => document.getElementById(`import-tab-${nextMode}`)?.focus());
  }

  function submitSingle() {
    if (bridgePairingRequest?.targetKind === "PROFILE") {
      setSingleValidation("This is a Janitor profile. Use Pair Profile in the Companion panel below.");
      return;
    }
    if (!singleUrl.trim()) return;
    setSingleValidation(null);
    onRetrieveSingle();
  }

  function beginReview() {
    if (bulk.overLimit || bulk.uniqueCount === 0) return;
    setReviewing(true);
    setSelectedUrls(new Set(selectableBulkUrls(bulk)));
  }

  function toggleUrl(sourceUrl: string) {
    setSelectedUrls((current) => {
      const next = new Set(current);
      if (next.has(sourceUrl)) next.delete(sourceUrl);
      else next.add(sourceUrl);
      return next;
    });
  }

  return (
    <div aria-labelledby="add-character-heading">
      <div className="p-4 sm:p-5">
        <p className="archive-eyebrow">Import from URL</p>
        <h1 id="add-character-heading" className="mt-1 text-xl font-bold uppercase tracking-[-0.015em] text-zinc-50 sm:text-2xl">Import from URL</h1>
        <p className="mt-1 text-sm text-zinc-500">Paste a supported character URL and preview it securely.</p>

        <div role="tablist" aria-label="Character retrieval mode" className="import-mode-tabs mt-4">
          <ModeTab mode="single" selected={mode === "single"} onSelect={chooseMode} onKeyDown={handleTabKey}>Single Retrieve</ModeTab>
          <ModeTab mode="bulk" selected={mode === "bulk"} onSelect={chooseMode} onKeyDown={handleTabKey}>Bulk Retrieve</ModeTab>
        </div>

        {mode === "single" ? (
          <div id="import-panel-single" role="tabpanel" aria-labelledby="import-tab-single" className="pt-4">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitSingle();
              }}
            >
              <label htmlFor="character-source-url" className="sr-only">Paste any character URL</label>
              <div className="import-single-row">
                <div className="import-source-mark" aria-hidden="true">↗</div>
                <input
                  id="character-source-url"
                  type="url"
                  required
                  value={singleUrl}
                  onChange={(event) => {
                    onSingleUrlChange(event.target.value);
                    setSingleValidation(null);
                  }}
                  aria-describedby="single-source-status single-import-error"
                  className="archive-input min-w-0 flex-1"
                  placeholder="Paste any character URL..."
                />
                <button type="submit" disabled={loading} className="import-retrieve-button archive-focus">
                  {loading ? "Previewing…" : "Preview Character"}
                </button>
              </div>
            </form>
            <SourceDetectionStatus bridgePairingRequest={bridgePairingRequest} detectedProvider={detectedProvider} supportState={supportState} />
            {singleValidation && <p id="single-import-error" role="alert" className="mt-2 text-xs text-red-300">{singleValidation}</p>}
          </div>
        ) : (
          <div id="import-panel-bulk" role="tabpanel" aria-labelledby="import-tab-bulk" className="pt-4">
            {reviewing ? (
              <BulkReview
                analysis={bulk}
                selectedUrls={selectedUrls}
                onToggle={toggleUrl}
                onSelectAll={() => setSelectedUrls(new Set(selectableBulkUrls(bulk)))}
                onDeselectAll={() => setSelectedUrls(new Set())}
                onBack={() => setReviewing(false)}
              />
            ) : (
              <>
                <label htmlFor="bulk-character-urls" className="text-xs font-semibold text-zinc-300">Paste character URLs</label>
                <p className="mt-1 text-[0.68rem] text-zinc-600">One URL per line or separated by commas.</p>
                <textarea
                  id="bulk-character-urls"
                  rows={7}
                  value={bulkInput}
                  onChange={(event) => {
                    setBulkInput(event.target.value);
                    setReviewing(false);
                  }}
                  aria-describedby="bulk-url-summary bulk-url-error"
                  className="archive-input mt-2 resize-y font-mono text-xs leading-5"
                  placeholder={"https://janitorai.com/characters/…\nhttps://saucepan.ai/companion/…"}
                />
                <BulkSummary analysis={bulk} />
                {bulk.overLimit && <p id="bulk-url-error" role="alert" className="mt-2 text-xs text-red-300">Maximum {BULK_CHARACTER_URL_LIMIT} character URLs per batch.</p>}
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={beginReview} disabled={bulk.uniqueCount === 0 || bulk.overLimit} className="archive-button-secondary archive-focus">Review URLs</button>
                </div>
              </>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
      </div>
    </div>
  );
}

function ModeTab({ mode, selected, onSelect, onKeyDown, children }: { mode: RetrievalMode; selected: boolean; onSelect: (mode: RetrievalMode) => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, mode: RetrievalMode) => void; children: ReactNode }) {
  return <button id={`import-tab-${mode}`} type="button" role="tab" aria-selected={selected} aria-controls={`import-panel-${mode}`} tabIndex={selected ? 0 : -1} onClick={() => onSelect(mode)} onKeyDown={(event) => onKeyDown(event, mode)} className="import-mode-tab archive-focus">{children}</button>;
}

function SourceDetectionStatus({ bridgePairingRequest, detectedProvider, supportState }: { bridgePairingRequest: BridgePairingRequest | null; detectedProvider: SourcePlatformIdentity | null; supportState: SourceSupportState | null }) {
  if (bridgePairingRequest?.targetKind === "PROFILE") return <div id="single-source-status" className="mt-2 flex flex-wrap items-center gap-2 text-[0.68rem] text-zinc-500"><SourceBadge platform="JANITOR_AI" variant="compact" /><span>Janitor profile detected.</span><span>Use Pair Profile in the Companion panel below.</span></div>;
  if (detectedProvider && supportState) return <div id="single-source-status" className="mt-2 flex flex-wrap items-center gap-2 text-[0.68rem] text-zinc-500"><SourceBadge platform={detectedProvider} variant="compact" /><span>Source detected: {getSourceIdentity(detectedProvider).label}</span></div>;
  return <p id="single-source-status" className="mt-2 text-[0.68rem] text-zinc-600">Source is detected securely by the server after you preview the URL.</p>;
}

function BulkSummary({ analysis }: { analysis: BulkCharacterUrlAnalysis }) {
  return (
    <div id="bulk-url-summary" aria-live="polite" className="font-interface mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] uppercase tracking-[0.05em] text-zinc-500">
      <span>{analysis.validCount} valid</span><span>{analysis.invalidCount} invalid</span><span>{analysis.duplicateCount} duplicates</span><span className="sm:ml-auto">{analysis.uniqueCount} / {BULK_CHARACTER_URL_LIMIT} unique entries</span>
    </div>
  );
}

function BulkReview({ analysis, selectedUrls, onToggle, onSelectAll, onDeselectAll, onBack }: { analysis: BulkCharacterUrlAnalysis; selectedUrls: Set<string>; onToggle: (url: string) => void; onSelectAll: () => void; onDeselectAll: () => void; onBack: () => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="archive-eyebrow">Bulk Retrieve</p><h2 className="mt-1 text-base font-semibold text-zinc-100">{analysis.validCount} character URLs ready for review</h2></div>
        <div className="font-interface text-[0.65rem] uppercase tracking-[0.06em] text-zinc-500">Invalid {analysis.invalidCount} · Unsupported {unsupportedCount(analysis)} · Duplicates {analysis.duplicateCount}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.entries(analysis.sourceCounts).map(([platform, count]) => <span key={platform} className="archive-chip"><SourceBadge platform={platform as SourcePlatformIdentity} variant="compact" />{getSourceIdentity(platform as SourcePlatformIdentity).label} {count}</span>)}
      </div>
      <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-zinc-800">
        {analysis.items.map((item, index) => {
          const selectable = item.detection.recognized && item.detection.bulkCapability === "READY";
          const label = item.detection.recognized ? `${getSourceIdentity(item.detection.platform).label} ${item.detection.externalId}` : item.detection.message;
          return (
            <label key={item.sourceUrl} className="flex gap-3 border-b border-zinc-800 px-3 py-2.5 last:border-b-0">
              <input type="checkbox" checked={selectedUrls.has(item.sourceUrl)} disabled={!selectable} onChange={() => onToggle(item.sourceUrl)} aria-label={`Select URL ${index + 1}`} className="mt-0.5 accent-[var(--accent-color)]" />
              <span className="min-w-0 flex-1"><span className="block text-xs text-zinc-300">{label}</span><span className="block truncate text-[0.65rem] text-zinc-600" title={item.sourceUrl}>{item.sourceUrl}</span></span>
              <span className={`font-interface text-[0.58rem] font-bold uppercase ${selectable ? "text-emerald-400" : item.detection.recognized ? "text-amber-400" : "text-red-400"}`}>{selectable ? "Ready" : item.detection.recognized ? "Unsupported" : "Invalid"}</span>
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-[0.68rem] text-zinc-600">Select All applies only to valid, retrieval-capable URLs in this current batch.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onSelectAll} className="archive-button-secondary archive-focus">Select All</button>
        <button type="button" onClick={onDeselectAll} className="archive-button-secondary archive-focus">Deselect All</button>
        <span className="font-interface ml-auto text-xs uppercase text-zinc-400">Selected: {selectedUrls.size}</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-zinc-800 pt-4">
        <button type="button" onClick={onBack} className="archive-button-secondary archive-focus">Back</button>
        <button type="button" disabled title="Bulk execution is deferred until a safe source adapter is available." aria-describedby="bulk-execution-note" className="import-retrieve-button archive-focus disabled:cursor-not-allowed disabled:opacity-45">Retrieve Selected</button>
      </div>
      <p id="bulk-execution-note" className="mt-2 text-right text-[0.68rem] text-zinc-600">Bulk retrieval execution is not enabled until a safe source adapter is available.</p>
    </div>
  );
}

export function selectableBulkUrls(analysis: BulkCharacterUrlAnalysis): string[] {
  return analysis.items.filter(({ detection }) => detection.recognized && detection.bulkCapability === "READY").map(({ sourceUrl }) => sourceUrl);
}

function unsupportedCount(analysis: BulkCharacterUrlAnalysis): number {
  return analysis.items.filter(({ detection }) => detection.recognized && detection.bulkCapability === "UNSUPPORTED").length;
}

function safeBridgePairingRequest(sourceUrl: string): BridgePairingRequest | null {
  try { return bridgePairingRequestForUrl(sourceUrl); } catch { return null; }
}
