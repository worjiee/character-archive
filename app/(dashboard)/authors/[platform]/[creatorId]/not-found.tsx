import Link from "next/link";

export default function AuthorNotFound() {
  return (
    <div className="archive-panel grid min-h-80 place-items-center border-dashed px-6 py-14 text-center">
      <div><p className="archive-eyebrow">Not found</p><h1 className="mt-2 text-xl font-semibold text-zinc-100">This source-scoped author is unavailable</h1><p className="mt-2 text-sm leading-6 text-zinc-500">The platform or external creator identity is invalid, missing, or no longer represented in the repository.</p><Link href="/authors" className="archive-button-secondary archive-focus mt-5">Back to authors</Link></div>
    </div>
  );
}
