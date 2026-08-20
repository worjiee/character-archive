import Link from "next/link";

export default function LorebookNotFound() {
  return (
    <div className="archive-panel mx-auto grid min-h-80 max-w-2xl place-items-center border-dashed px-6 py-14 text-center">
      <div>
        <p className="archive-eyebrow">Not found</p>
        <h1 className="mt-2 text-xl font-semibold text-zinc-100">Lorebook unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">This lorebook does not exist in the repository or is no longer available.</p>
        <Link href="/lorebooks" className="archive-button-secondary archive-focus mt-5">Back to Lorebooks</Link>
      </div>
    </div>
  );
}
