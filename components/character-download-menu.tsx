"use client";

import { useEffect, useId, useReducer, useRef } from "react";

export const CHARACTER_DOWNLOAD_FORMATS = [
  { key: "json", label: "JSON", description: "Normalized character data" },
] as const;

export function characterDownloadMenuResetKey(characterId: string): string {
  return `character-download:${characterId}`;
}

export interface CharacterDownloadMenuState {
  open: boolean;
  busy: boolean;
  error: string | null;
}

export type CharacterDownloadMenuEvent =
  | { type: "toggle" }
  | { type: "dismiss" }
  | { type: "download-start" }
  | { type: "download-success" }
  | { type: "download-failure"; message: string };

const CLOSED_DOWNLOAD_MENU: CharacterDownloadMenuState = { open: false, busy: false, error: null };

export function CharacterDownloadMenu({
  characterId,
  archiveSource,
  defaultOpen = false,
}: {
  characterId: string;
  archiveSource: string;
  defaultOpen?: boolean;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const jsonItemRef = useRef<HTMLButtonElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, dispatch] = useReducer(characterDownloadMenuReducer, {
    ...CLOSED_DOWNLOAD_MENU,
    open: defaultOpen,
  });

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!state.open) return;

    function handlePointerDown(event: PointerEvent) {
      if (isOutsideDownloadMenu(rootRef.current, event.target)) dispatch({ type: "dismiss" });
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (!shouldDismissDownloadMenuForKey(event.key, state.open)) return;
      event.preventDefault();
      event.stopPropagation();
      dispatch({ type: "dismiss" });
      focusDownloadTrigger(triggerRef.current);
    }

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [state.open]);

  function toggleMenu() {
    if (!state.open) requestAnimationFrame(() => jsonItemRef.current?.focus());
    dispatch({ type: "toggle" });
  }

  async function downloadJson() {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    dispatch({ type: "download-start" });
    try {
      await requestCharacterJsonDownload(characterId, { signal: controller.signal });
      if (abortRef.current !== controller) return;
      dispatch({ type: "download-success" });
      focusDownloadTrigger(triggerRef.current);
    } catch (error) {
      if (controller.signal.aborted || abortRef.current !== controller) return;
      dispatch({
        type: "download-failure",
        message: error instanceof CharacterDownloadError
          ? error.message
          : "The character could not be downloaded. Please try again.",
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  return (
    <div ref={rootRef} className="character-download-menu-wrap" data-download-character-id={characterId}>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Download character"
        aria-haspopup="menu"
        aria-expanded={state.open}
        aria-controls={menuId}
        data-open={state.open}
        onClick={toggleMenu}
        className="character-download-trigger archive-focus"
      >Download <span aria-hidden="true">▾</span></button>

      {state.open && (
        <div id={menuId} role="menu" aria-label="Download character" className="character-download-menu">
          <div className="character-download-menu-header">
            <span>Download character</span>
            <span>Archive source</span>
            <strong>{archiveSource}</strong>
          </div>
          <button
            ref={jsonItemRef}
            type="button"
            role="menuitem"
            disabled={state.busy}
            onClick={() => void downloadJson()}
            className="character-download-format archive-focus"
          >
            <span>{state.busy ? "Preparing…" : CHARACTER_DOWNLOAD_FORMATS[0].label}</span>
            <small>{CHARACTER_DOWNLOAD_FORMATS[0].description}</small>
          </button>
          {state.error && <p role="alert" className="character-download-error">{state.error}</p>}
        </div>
      )}
    </div>
  );
}

export function characterDownloadMenuReducer(
  state: CharacterDownloadMenuState,
  event: CharacterDownloadMenuEvent,
): CharacterDownloadMenuState {
  switch (event.type) {
    case "toggle":
      return state.open ? CLOSED_DOWNLOAD_MENU : { open: true, busy: false, error: null };
    case "dismiss":
    case "download-success":
      return CLOSED_DOWNLOAD_MENU;
    case "download-start":
      return { open: true, busy: true, error: null };
    case "download-failure":
      return { open: true, busy: false, error: event.message };
  }
}

export function shouldDismissDownloadMenuForKey(key: string, open: boolean): boolean {
  return open && key === "Escape";
}

export function isOutsideDownloadMenu(
  container: { contains(node: Node | null): boolean } | null,
  target: EventTarget | null,
): boolean {
  return Boolean(container && target && !container.contains(target as Node));
}

export function focusDownloadTrigger(trigger: Pick<HTMLButtonElement, "focus"> | null): void {
  trigger?.focus();
}

export class CharacterDownloadError extends Error {
  constructor(message = "The character could not be downloaded. Please try again.") {
    super(message);
    this.name = "CharacterDownloadError";
  }
}

export async function requestCharacterJsonDownload(
  characterId: string,
  options: {
    signal?: AbortSignal;
    fetcher?: (input: string, init: RequestInit) => Promise<Response>;
    saveFile?: (blob: Blob, filename: string) => void;
  } = {},
): Promise<string> {
  const response = await (options.fetcher ?? fetch)(
    `/api/characters/${encodeURIComponent(characterId)}/export/json`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: options.signal,
    },
  );
  if (!response.ok) throw new CharacterDownloadError();

  const blob = await response.blob();
  const filename = attachmentJsonFilename(response.headers.get("content-disposition"));
  (options.saveFile ?? saveBrowserFile)(blob, filename);
  return filename;
}

export function attachmentJsonFilename(contentDisposition: string | null): string {
  const match = contentDisposition?.match(/filename="([a-z0-9][a-z0-9-]{0,89}\.json)"/i);
  return match?.[1]?.toLowerCase() ?? "character-export.json";
}

function saveBrowserFile(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}
