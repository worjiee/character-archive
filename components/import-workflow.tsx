"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ImportPreview } from "@/src/lib/importers/workflow";
import type { PersistNormalizedCharacterResult } from "@/src/lib/importers/persistence";
import { CharacterAvatar } from "./character-avatar";
import { SourceBadge } from "./character-badges";
import { ImportRetrievalPanel } from "./import-retrieval-panel";
import { JanitorBridgePanel } from "./janitor-bridge-panel";
import { ArtifactImportPanel } from "./artifact-import-panel";
import { PreviewImportUnavailable } from "./preview-import-unavailable";

interface ImportWorkflowProps {
  automaticFixtureEnabled: boolean;
  artifactUploadsEnabled?: boolean;
  experimentalImportsVisible?: boolean;
  initialUrl: string;
  isAdmin?: boolean;
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; savedCharacterId?: string };
}
type ImportMethod = "automatic-url" | "manual-json" | "browser-bridge";

export function ImportWorkflow({
  automaticFixtureEnabled,
  artifactUploadsEnabled = true,
  experimentalImportsVisible = true,
  initialUrl,
  isAdmin = true,
}: ImportWorkflowProps) {
  void automaticFixtureEnabled;
  const [automaticUrl, setAutomaticUrl] = useState(initialUrl);
  const [manualUrl, setManualUrl] = useState(initialUrl);
  const [sourceJson, setSourceJson] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [linkMode, setLinkMode] = useState<
    "CREATE_SEPARATE" | "ATTACH_TO_EXISTING"
  >("CREATE_SEPARATE");
  const [selectedTargetCharacterId, setSelectedTargetCharacterId] = useState<
    string | null
  >(null);
  const [savedLinkMode, setSavedLinkMode] = useState<
    "CREATE_SEPARATE" | "ATTACH_TO_EXISTING"
  >("CREATE_SEPARATE");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<ImportMethod | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedCharacterId, setSavedCharacterId] = useState<string | null>(null);
  const [saveResult, setSaveResult] =
    useState<PersistNormalizedCharacterResult | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<{
    connected: boolean;
    expiresAt: string | null;
  } | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionToken, setConnectionToken] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [showConnectForm, setShowConnectForm] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    async function loadStatus() {
      try {
        const res = await fetch("/api/connections/janitor/status");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setConnectionStatus({
              connected: Boolean(data.connected),
              expiresAt: data.expiresAt ?? null,
            });
          }
        }
      } catch {
        // Safe silent fail on initial status check
      }
    }
    void loadStatus();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!connectionToken.trim()) return;
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      const res = await fetch("/api/connections/janitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: connectionToken }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectionError(data.error?.message || "Failed to connect Janitor.");
      } else {
        setConnectionStatus({ connected: true, expiresAt: null });
        setConnectionToken("");
        setShowConnectForm(false);
      }
    } catch {
      setConnectionError("Failed to connect Janitor. Network error.");
    } finally {
      setConnectionLoading(false);
    }
  }

  async function handleDisconnect() {
    setConnectionLoading(true);
    setConnectionError(null);
    try {
      const res = await fetch("/api/connections/janitor", { method: "DELETE" });
      if (res.ok) {
        setConnectionStatus({ connected: false, expiresAt: null });
      }
    } catch {
      setConnectionError("Failed to disconnect Janitor.");
    } finally {
      setConnectionLoading(false);
    }
  }

  function resetResult() {
    setPreview(null);
    setPreviewJobId(null);
    setSavedCharacterId(null);
    setSaveResult(null);
    setLinkMode("CREATE_SEPARATE");
    setSelectedTargetCharacterId(null);
    setSavedLinkMode("CREATE_SEPARATE");
  }

  async function requestPreview(method: ImportMethod) {
    if (method === "browser-bridge") return;
    if (loading) return;
    const selectedUrl =
      method === "manual-json" ? manualUrl.trim() : automaticUrl.trim();
    setLoading(method);
    setError(null);
    resetResult();
    try {
      const payload =
        method === "manual-json"
          ? { method, url: selectedUrl, sourceJson }
          : { method, url: selectedUrl };
      const response = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        preview?: ImportPreview;
        previewJobId?: string;
      } & ApiErrorBody;
      if (!response.ok || !body.preview || !body.previewJobId) {
        throw new Error(
          body.error?.message ?? "The character preview could not be created.",
        );
      }
      setPreview(body.preview);
      setPreviewJobId(body.previewJobId);
      setLinkMode("CREATE_SEPARATE");
      const firstCandidate = body.preview.duplicateAnalysis?.candidates?.[0];
      setSelectedTargetCharacterId(firstCandidate?.characterId ?? null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    } finally {
      setLoading(null);
    }
  }

  async function handleSave() {
    if (!previewJobId || !preview || saving || savedCharacterId) return;
    setSaving(true);
    setError(null);
    try {
      const method: ImportMethod = preview.provider === "browser-bridge"
        ? "browser-bridge"
        : preview.provider === "manual-json" ? "manual-json" : "automatic-url";
      const payload: Record<string, unknown> = {
        method,
        previewJobId,
      };

      if (
        isAdmin &&
        preview.duplicateAnalysis?.candidates &&
        preview.duplicateAnalysis.candidates.length > 0
      ) {
        payload.linkMode = linkMode;
        if (linkMode === "ATTACH_TO_EXISTING") {
          if (!selectedTargetCharacterId) {
            throw new Error("Please select a target character to attach this source to.");
          }
          payload.targetCharacterId = selectedTargetCharacterId;
        }
      }

      const response = await fetch("/api/import/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as {
        result?: PersistNormalizedCharacterResult;
      } & ApiErrorBody;
      if (!response.ok || !body.result) {
        if (body.error?.code === "PREVIEW_CONSUMED" && body.error.savedCharacterId) {
          setSavedCharacterId(body.error.savedCharacterId);
        }
        throw new Error(
          body.error?.message ?? "The character could not be saved.",
        );
      }
      setSavedCharacterId(body.result.characterId);
      setSaveResult(body.result);
      setSavedLinkMode(linkMode);
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
      setError(
        "The selected JSON file is too large. Character JSON is limited to 1 MB.",
      );
      return;
    }
    try {
      setSourceJson(await file.text());
    } catch {
      setError("The selected JSON file could not be read.");
    }
  }

  return (
    <div className="mx-auto max-w-[68rem]">
      <section className="archive-panel mx-auto max-w-[52rem] overflow-hidden">
        {artifactUploadsEnabled ? <ArtifactImportPanel /> : <PreviewImportUnavailable />}
        {experimentalImportsVisible && <details className="group border-t border-zinc-800 bg-zinc-950/20">
          <summary className="archive-focus cursor-pointer list-none px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400 marker:hidden sm:px-5">
            Alternative imports <span className="float-right transition group-open:rotate-45" aria-hidden="true">＋</span>
          </summary>
          <div className="border-t border-zinc-800 p-4 sm:p-5">
        <ImportRetrievalPanel
          singleUrl={automaticUrl}
          onSingleUrlChange={(value) => {
            setAutomaticUrl(value);
            resetResult();
          }}
          loading={loading === "automatic-url"}
          error={error}
          onRetrieveSingle={() => void requestPreview("automatic-url")}
        />
      <div className="hidden">
        <p className="archive-eyebrow">Add to library</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">
          Import a character
        </h1>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
          Retrieve or validate one Janitor AI character, review the normalized
          preview, then save it to this private archive.
        </p>
      </div>

      <div className="mx-auto max-w-[52rem]">
        <section className="overflow-hidden">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="archive-eyebrow">Janitor AI</p>
                <h2 className="mt-1.5 text-lg font-semibold text-zinc-100">
                  Add AI Character
                </h2>
              </div>
              <span className="archive-chip">Private repository</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Experimental · Production development paused. Pair the opt-in browser companion only for retained diagnostic workflows.
            </p>

            <JanitorBridgePanel
              targetUrl={automaticUrl}
              onPreview={(receivedPreviewJobId, receivedPreview) => {
                resetResult();
                setPreviewJobId(receivedPreviewJobId);
                setPreview(receivedPreview);
                const firstCandidate = receivedPreview.duplicateAnalysis?.candidates?.[0];
                setSelectedTargetCharacterId(firstCandidate?.characterId ?? null);
              }}
            />

            {isAdmin && <details className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/30">
              <summary className="archive-focus cursor-pointer list-none px-4 py-3 text-xs font-semibold text-zinc-300 marker:hidden">
                Advanced / Experimental server connector
                <span className="float-right text-zinc-500">＋</span>
              </summary>
              <p className="border-t border-zinc-800 px-4 pt-3 text-xs leading-5 text-amber-200/80">
                Experimental server connector — Janitor currently rejects server-context retrieval even with a credential accepted by the browser.
              </p>
            <div className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      connectionStatus?.connected
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                        : "bg-zinc-600"
                    }`}
                  />
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      Janitor AI Connection
                    </span>
                    <span className="ml-2 text-xs text-zinc-400">
                      {connectionStatus?.connected
                        ? "● Connected"
                        : "○ Not connected"}
                    </span>
                  </div>
                </div>

                <div>
                  {connectionStatus?.connected ? (
                    <button
                      type="button"
                      disabled={connectionLoading}
                      onClick={() => void handleDisconnect()}
                      className="rounded border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-300 transition hover:bg-red-500/20"
                    >
                      {connectionLoading ? "Disconnecting…" : "Disconnect"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowConnectForm(!showConnectForm)}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700"
                    >
                      {showConnectForm ? "Cancel" : "Connect"}
                    </button>
                  )}
                </div>
              </div>

              {!connectionStatus?.connected && showConnectForm && (
                <form
                  onSubmit={(e) => void handleConnect(e)}
                  className="mt-3.5 border-t border-zinc-800/80 pt-3"
                >
                  <label
                    htmlFor="janitor-connection-token"
                    className="block text-xs font-medium text-zinc-300"
                  >
                    Janitor Bearer Token
                  </label>
                  <p className="mt-1 text-[11px] text-zinc-400">
                    Stored for explicit administrator diagnostics only. Normal Single Retrieve is always public-only.
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id="janitor-connection-token"
                      type="password"
                      required
                      value={connectionToken}
                      onChange={(e) => setConnectionToken(e.target.value)}
                      placeholder="Paste token..."
                      className="archive-input min-w-0 flex-1 text-xs"
                      autoComplete="off"
                    />
                    <button
                      type="submit"
                      disabled={connectionLoading || !connectionToken.trim()}
                      className="archive-button-primary archive-focus shrink-0 px-3 py-1.5 text-xs"
                    >
                      {connectionLoading ? "Saving…" : "Connect Janitor"}
                    </button>
                  </div>
                  {connectionError && (
                    <p className="mt-2 text-xs text-red-400">{connectionError}</p>
                  )}
                </form>
              )}
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void requestPreview("automatic-url");
              }}
              className="mt-4"
            >
              <label
                htmlFor="automatic-janitor-url"
                className="text-xs font-medium text-zinc-300"
              >
                Character URL
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="automatic-janitor-url"
                  type="url"
                  required
                  value={automaticUrl}
                  onChange={(event) => {
                    setAutomaticUrl(event.target.value);
                    resetResult();
                  }}
                  className="archive-input min-w-0 flex-1"
                  placeholder="https://janitorai.com/characters/..."
                />
                <button
                  type="submit"
                  disabled={loading !== null}
                  className="archive-button-primary archive-focus shrink-0"
                >
                  {loading === "automatic-url"
                    ? "Retrieving…"
                    : "Retrieve & Preview"}
                </button>
              </div>
            </form>
            </details>}
          </div>

          <details className="group border-t border-zinc-800 bg-zinc-950/25">
            <summary className="archive-focus cursor-pointer list-none px-5 py-4 marker:hidden sm:px-6">
              <span className="text-sm font-semibold text-zinc-200">
                Advanced / Manual Import
              </span>
              <span className="ml-2 text-xs text-zinc-500">
                Working JSON fallback
              </span>
              <span className="float-right text-zinc-500 transition group-open:rotate-45">
                ＋
              </span>
            </summary>
            <div className="border-t border-zinc-800 px-5 pb-6 pt-5 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="archive-eyebrow">Manual character data</p>
                <span className="archive-chip">Validated import</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-400">
                Paste the structured character response only. Do not paste
                cookies, authorization headers, tokens, HAR files, or browser
                storage.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void requestPreview("manual-json");
                }}
                className="mt-4 grid gap-4"
              >
                <label className="block">
                  <span className="text-xs font-medium text-zinc-300">
                    Original Janitor character URL
                  </span>
                  <input
                    type="url"
                    required
                    value={manualUrl}
                    onChange={(event) => {
                      setManualUrl(event.target.value);
                      resetResult();
                    }}
                    className={inputClass}
                    placeholder="https://janitorai.com/characters/..."
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-zinc-300">
                    Paste JSON
                  </span>
                  <textarea
                    required
                    rows={10}
                    value={sourceJson}
                    onChange={(event) => {
                      setSourceJson(event.target.value);
                      resetResult();
                    }}
                    className={`${inputClass} resize-y font-mono text-xs leading-5`}
                    placeholder={'{\n  "id": "…",\n  "name": "…"\n}'}
                  />
                </label>
                <label className="block rounded-lg border border-dashed border-zinc-700 px-3 py-3 text-xs text-zinc-500">
                  <span className="block font-medium text-zinc-300">
                    Or upload a .json file
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) =>
                      void loadJsonFile(event.target.files?.[0])
                    }
                    className="mt-2 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-300"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading !== null}
                  className={primaryButton}
                >
                  {loading === "manual-json"
                    ? "Validating…"
                    : "Preview Character"}
                </button>
              </form>
            </div>
          </details>
        </section>
      </div>
          </div>
        </details>}
      </section>
      {preview && (
        <CharacterPreview
          preview={preview}
          canLinkExisting={isAdmin}
          linkMode={linkMode}
          onLinkModeChange={setLinkMode}
          selectedTargetCharacterId={selectedTargetCharacterId}
          onSelectTargetCharacterId={setSelectedTargetCharacterId}
          savedCharacterId={savedCharacterId}
          savedLinkMode={savedLinkMode}
          saveResult={saveResult}
          saving={saving}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function CharacterPreview({
  preview,
  canLinkExisting,
  linkMode,
  onLinkModeChange,
  selectedTargetCharacterId,
  onSelectTargetCharacterId,
  savedCharacterId,
  savedLinkMode,
  saveResult,
  saving,
  onSave,
}: {
  preview: ImportPreview;
  canLinkExisting: boolean;
  linkMode: "CREATE_SEPARATE" | "ATTACH_TO_EXISTING";
  onLinkModeChange: (mode: "CREATE_SEPARATE" | "ATTACH_TO_EXISTING") => void;
  selectedTargetCharacterId: string | null;
  onSelectTargetCharacterId: (id: string) => void;
  savedCharacterId: string | null;
  savedLinkMode: "CREATE_SEPARATE" | "ATTACH_TO_EXISTING";
  saveResult: PersistNormalizedCharacterResult | null;
  saving: boolean;
  onSave: () => Promise<void>;
}) {
  const candidates = preview.duplicateAnalysis?.candidates ?? [];
  const hasCandidates = candidates.length > 0;

  return (
    <section
      aria-labelledby="preview-heading"
      className="archive-panel mt-5 overflow-hidden"
    >
      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(190px,240px)_1fr]">
        <CharacterAvatar
          name={preview.name}
          src={preview.avatarUrl}
          className="aspect-[3/4] w-full max-w-[240px] rounded-xl"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge platform={preview.platform} variant="compact" />
            <span
              className={
                preview.provider === "manual-json"
                  ? "rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300"
                  : preview.provider === "automatic-url"
                  ? "rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-200"
                  : "rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-200"
              }
            >
              {preview.provider === "manual-json"
                ? "Manual JSON"
                : preview.provider === "browser-bridge"
                ? "Character Archive Companion"
                : preview.provider === "automatic-url"
                ? "Automatic URL"
                : "Development fixture"}
            </span>
          </div>
          <h2
            id="preview-heading"
            className="mt-4 text-2xl font-semibold text-zinc-50"
          >
            {preview.name}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            by {preview.creator.name ?? "Unknown creator"}
          </p>
          <a
            href={preview.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={preview.sourceUrl}
            className="archive-focus mt-2 block max-w-2xl truncate text-xs text-violet-400 hover:text-violet-300"
          >
            {preview.sourceUrl}
          </a>
          <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-300">
            {preview.description ?? "No description provided."}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {preview.tags.map((tag) => (
              <span
                key={tag.slug}
                className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
              >
                {tag.name}
              </span>
            ))}
            {preview.tags.length === 0 && (
              <span className="text-xs text-zinc-500">No tags</span>
            )}
          </div>
          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3">
              <dt className="text-zinc-500">Greetings</dt>
              <dd className="mt-1 font-medium text-zinc-200">
                {preview.greetings.length}
              </dd>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/45 p-3">
              <dt className="text-zinc-500">Lorebook references</dt>
              <dd className="mt-1 font-medium text-zinc-200">
                {preview.lorebookReferences.length}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {preview.duplicateAnalysis?.classification === "EXACT_SOURCE" && (
        <div className="border-t border-zinc-800 bg-violet-950/20 px-5 py-3 text-xs text-violet-200">
          <span className="font-semibold">Exact source match in archive:</span>{" "}
          Re-importing this source will update the existing record.
        </div>
      )}

      {hasCandidates && (
        <div className="border-t border-zinc-800 bg-amber-500/5 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-amber-400">⚠</span>
              <h3 className="text-xs font-semibold text-amber-200">
                Possible existing archive match
              </h3>
            </div>
            <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
              {canLinkExisting ? "Administrator choice required" : "Separate import only"}
            </span>
          </div>

          <div className="mt-3 space-y-3">
            {candidates.map((candidate) => {
              const isSelected = selectedTargetCharacterId === candidate.characterId;
              return (
                <div
                  key={candidate.characterId}
                  onClick={() => {
                    if (canLinkExisting && linkMode === "ATTACH_TO_EXISTING") {
                      onSelectTargetCharacterId(candidate.characterId);
                    }
                  }}
                  className={`rounded-lg border p-3 text-xs transition ${
                    linkMode === "ATTACH_TO_EXISTING" && isSelected
                      ? "border-amber-500/50 bg-amber-500/10"
                      : "border-zinc-800 bg-zinc-950/60"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {canLinkExisting && linkMode === "ATTACH_TO_EXISTING" && (
                        <input
                          type="radio"
                          name="targetCandidate"
                          checked={isSelected}
                          onChange={() => onSelectTargetCharacterId(candidate.characterId)}
                          className="text-amber-500 focus:ring-amber-500"
                        />
                      )}
                      <span className="font-medium text-zinc-200">
                        {candidate.name}
                      </span>
                      {candidate.creatorName && (
                        <span className="text-zinc-500">
                          by {candidate.creatorName}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-500">
                        Existing sources:
                      </span>
                      {candidate.sources.map((s) => (
                        <SourceBadge key={s.platform} platform={s.platform} variant="compact" />
                      ))}
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1 text-zinc-400">
                    {candidate.evidence.map((ev) => (
                      <li key={ev.code} className="flex items-center gap-1.5">
                        <span className="text-zinc-500">•</span>
                        <span>{ev.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/70 p-3.5">
            <p className="text-xs font-semibold text-zinc-200">Import Action</p>
            <div className="mt-2.5 space-y-2">
              {canLinkExisting && <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="linkMode"
                  value="CREATE_SEPARATE"
                  checked={linkMode === "CREATE_SEPARATE"}
                  onChange={() => onLinkModeChange("CREATE_SEPARATE")}
                  className="mt-0.5 text-violet-500 focus:ring-violet-500"
                />
                <div>
                  <span className="font-medium text-zinc-200">
                    Create separate character
                  </span>
                  <p className="text-zinc-400">
                    Creates an independent canonical character record (default).
                  </p>
                </div>
              </label>}
              <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                <input
                  type="radio"
                  name="linkMode"
                  value="ATTACH_TO_EXISTING"
                  checked={linkMode === "ATTACH_TO_EXISTING"}
                  onChange={() => {
                    onLinkModeChange("ATTACH_TO_EXISTING");
                    if (!selectedTargetCharacterId && candidates[0]) {
                      onSelectTargetCharacterId(candidates[0].characterId);
                    }
                  }}
                  className="mt-0.5 text-amber-500 focus:ring-amber-500"
                />
                <div>
                  <span className="font-medium text-zinc-200">
                    Attach as another source to existing character
                  </span>
                  <p className="text-zinc-400">
                    Attaching keeps one archive character while preserving this
                    source&apos;s provenance separately.
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-zinc-800 px-5 py-4 md:px-6">
        <PreviewDetails
          title="Personality"
          empty="No personality provided."
          hasContent={Boolean(preview.personality)}
        >
          <p>{preview.personality}</p>
        </PreviewDetails>
        <PreviewDetails
          title="Scenario"
          empty="No scenario provided."
          hasContent={Boolean(preview.scenario)}
        >
          <p>{preview.scenario}</p>
        </PreviewDetails>
        <PreviewDetails
          title={`Greetings (${preview.greetings.length})`}
          empty="No greetings provided."
          hasContent={preview.greetings.length > 0}
        >
          <ol className="space-y-3">
            {preview.greetings.map((greeting) => (
              <li
                key={`${greeting.position}-${greeting.content}`}
                className="rounded-lg bg-zinc-950/55 p-3"
              >
                <span className="mr-2 text-xs font-semibold text-violet-400">
                  {greeting.position + 1}
                </span>
                {greeting.content}
              </li>
            ))}
          </ol>
        </PreviewDetails>
        <PreviewDetails
          title={`Lorebook references (${preview.lorebookReferences.length})`}
          empty="No lorebook references provided."
          hasContent={preview.lorebookReferences.length > 0}
        >
          <ul className="space-y-2">
            {preview.lorebookReferences.map((reference) => (
              <li key={reference.externalId}>
                {reference.title}{" "}
                <span className="text-xs text-zinc-600">
                  Reference only · content not retrieved
                </span>
              </li>
            ))}
          </ul>
        </PreviewDetails>
      </div>
      <div className="flex flex-col gap-3 border-t border-zinc-800 bg-zinc-950/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
        {savedCharacterId ? (
          <div
            role="status"
            className={
              saveResult?.status === "QUARANTINED"
                ? "text-sm text-amber-300"
                : "text-sm text-emerald-300"
            }
          >
            {saveResult?.status === "QUARANTINED" ? (
              <>
                <p className="font-semibold">Saved to quarantine.</p>
                <p className="mt-1 text-xs text-amber-200/80">
                  {saveResult.blockedReason ??
                    "Matched an enabled blocklist entry."}
                </p>
              </>
            ) : savedLinkMode === "ATTACH_TO_EXISTING" ? (
              <p>Source attached to existing character successfully.</p>
            ) : (
              <p>
                Saved successfully. Re-importing this source updates the same
                record.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-zinc-500">
            Save consumes the exact server-side snapshot shown here, then runs
            authoritative moderation and transactional persistence.
          </p>
        )}
        {savedCharacterId ? (
          <Link
            href={`/characters/${savedCharacterId}`}
            className={`archive-focus rounded-lg px-4 py-2.5 text-center text-xs font-semibold ${
              saveResult?.status === "QUARANTINED"
                ? "bg-amber-400 text-zinc-950 hover:bg-amber-300"
                : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
            }`}
          >
            {saveResult?.status === "QUARANTINED"
              ? "Review quarantined character"
              : "View character"}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => void onSave()}
            disabled={saving}
            className={primaryButton}
          >
            {saving
              ? "Saving…"
              : linkMode === "ATTACH_TO_EXISTING"
                ? "Attach Source to Character"
                : "Save to Library"}
          </button>
        )}
      </div>
    </section>
  );
}

function PreviewDetails({
  title,
  empty,
  hasContent,
  children,
}: {
  title: string;
  empty: string;
  hasContent: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group border-b border-zinc-800 py-3 last:border-b-0">
      <summary className="archive-focus cursor-pointer list-none rounded text-sm font-medium text-zinc-200 marker:hidden">
        {title}
        <span className="float-right text-zinc-500 transition group-open:rotate-45">
          ＋
        </span>
      </summary>
      <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-400">
        {hasContent ? children : empty}
      </div>
    </details>
  );
}

function getErrorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : "An unexpected error occurred.";
}

const inputClass = "archive-input mt-2 min-w-0";
const primaryButton = "archive-button-primary archive-focus";
const MAX_MANUAL_JSON_UPLOAD_BYTES = 1024 * 1024;
