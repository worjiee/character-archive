"use client";

export default function CharactersError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="archive-panel grid min-h-80 place-items-center border-dashed px-6 py-14 text-center"><div><p className="archive-eyebrow">Unable to load</p><h1 className="mt-2 text-xl font-semibold text-zinc-100">The character library is temporarily unavailable</h1><p className="mt-2 text-sm leading-6 text-zinc-500">No database details were exposed. Try the request again.</p><button type="button" onClick={reset} className="archive-button-secondary archive-focus mt-5">Try again</button></div></div>;
}
