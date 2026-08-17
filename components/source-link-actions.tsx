"use client";

import { useState } from "react";

export function SourceLinkActions({ sourceUrl }: { sourceUrl: string }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copySourceLink() {
    try {
      await navigator.clipboard.writeText(sourceUrl);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <a href={sourceUrl} target="_blank" rel="noreferrer" className="archive-focus rounded-md border border-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800">Open Original <span aria-hidden="true">↗</span></a>
      <button type="button" onClick={() => void copySourceLink()} className="archive-focus rounded-md px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">{copyState === "copied" ? "Copied" : "Copy Source Link"}</button>
      {copyState === "failed" && <span role="status" className="text-[10px] text-red-300">Copy failed. Open the link and copy it from the address bar.</span>}
    </div>
  );
}
