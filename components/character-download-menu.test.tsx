import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  attachmentJsonFilename,
  CHARACTER_DOWNLOAD_FORMATS,
  CharacterDownloadError,
  CharacterDownloadMenu,
  characterDownloadMenuReducer,
  characterDownloadMenuResetKey,
  focusDownloadTrigger,
  isOutsideDownloadMenu,
  requestCharacterJsonDownload,
  shouldDismissDownloadMenuForKey,
  type CharacterDownloadMenuState,
} from "./character-download-menu";

describe("character Download menu", () => {
  it("renders an accessible anchored trigger and the one truthful supported format", () => {
    const closedHtml = renderToStaticMarkup(
      <CharacterDownloadMenu characterId="character-1" archiveSource="Janitor AI" />,
    );
    const openHtml = renderToStaticMarkup(
      <CharacterDownloadMenu characterId="character-1" archiveSource="Janitor AI" defaultOpen />,
    );

    expect(closedHtml).toContain('aria-label="Download character"');
    expect(closedHtml).toContain('aria-haspopup="menu"');
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(openHtml).toContain('aria-expanded="true"');
    expect(openHtml).toContain('role="menu"');
    expect(openHtml).toContain('role="menuitem"');
    expect(openHtml).toContain("Archive source");
    expect(openHtml).toContain("Janitor AI");
    expect(openHtml).toContain("JSON");
    expect(openHtml).toContain("Normalized character data");
    expect(CHARACTER_DOWNLOAD_FORMATS.map(({ key }) => key)).toEqual(["json"]);
    expect(openHtml).not.toMatch(/>PNG</);
    expect(openHtml).not.toMatch(/>ZIP</);
    expect(openHtml).not.toContain("Add to Cart");
  });

  it("opens, dismisses outside, dismisses on Escape, and clears transient state", () => {
    const closed: CharacterDownloadMenuState = { open: false, busy: false, error: null };
    const open = characterDownloadMenuReducer(closed, { type: "toggle" });
    expect(open).toEqual({ open: true, busy: false, error: null });
    expect(characterDownloadMenuReducer(open, { type: "dismiss" })).toEqual(closed);
    expect(shouldDismissDownloadMenuForKey("Escape", true)).toBe(true);
    expect(shouldDismissDownloadMenuForKey("Escape", false)).toBe(false);
    expect(shouldDismissDownloadMenuForKey("Enter", true)).toBe(false);

    const inside = {} as EventTarget;
    const outside = {} as EventTarget;
    const container = { contains: (node: Node | null) => node === inside };
    expect(isOutsideDownloadMenu(container, inside)).toBe(false);
    expect(isOutsideDownloadMenu(container, outside)).toBe(true);
  });

  it("returns focus to the trigger when requested", () => {
    const focus = vi.fn();
    focusDownloadTrigger({ focus });
    expect(focus).toHaveBeenCalledOnce();
  });

  it("closes after success but remains open and retryable after failure", () => {
    const busy = characterDownloadMenuReducer(
      { open: true, busy: false, error: null },
      { type: "download-start" },
    );
    expect(characterDownloadMenuReducer(busy, { type: "download-success" }).open).toBe(false);
    expect(characterDownloadMenuReducer(busy, { type: "download-failure", message: "Try again." })).toEqual({
      open: true,
      busy: false,
      error: "Try again.",
    });
  });

  it("uses a character-scoped instance key so Previous, Next, and modal replacement start closed", () => {
    expect(characterDownloadMenuResetKey("previous")).not.toBe(characterDownloadMenuResetKey("next"));
    expect(characterDownloadMenuResetKey("next")).toBe("character-download:next");
  });

  it("downloads a successful response and rejects failed responses without saving", async () => {
    const saveFile = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Disposition": 'attachment; filename="theron.json"' },
    }));
    await expect(requestCharacterJsonDownload("character / 1", { fetcher, saveFile })).resolves.toBe("theron.json");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/characters/character%20%2F%201/export/json",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    );
    expect(saveFile).toHaveBeenCalledOnce();

    saveFile.mockClear();
    fetcher.mockResolvedValue(new Response("database details", { status: 500 }));
    await expect(requestCharacterJsonDownload("character-1", { fetcher, saveFile })).rejects.toBeInstanceOf(CharacterDownloadError);
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("accepts only a constrained JSON attachment filename", () => {
    expect(attachmentJsonFilename('attachment; filename="safe-name.json"')).toBe("safe-name.json");
    expect(attachmentJsonFilename('attachment; filename="../secret.json"')).toBe("character-export.json");
    expect(attachmentJsonFilename('attachment; filename="safe.json\r\nX-Bad: yes"')).toBe("character-export.json");
    expect(attachmentJsonFilename(null)).toBe("character-export.json");
  });
});
