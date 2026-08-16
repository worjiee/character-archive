import Link from "next/link";

export default function CharacterNotFound() {
  return <div className="grid min-h-[60vh] place-items-center text-center"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">404</p><h1 className="mt-3 text-2xl font-semibold text-zinc-100">Character not found</h1><p className="mt-2 text-sm text-zinc-500">This character does not exist or is no longer available.</p><Link href="/characters" className="mt-5 inline-flex rounded-lg border border-zinc-700 px-3.5 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800">Return to characters</Link></div></div>;
}
