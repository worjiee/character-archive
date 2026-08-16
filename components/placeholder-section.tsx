type PlaceholderSectionProps = { eyebrow: string; title: string; description: string; note: string };

export function PlaceholderSection({ eyebrow, title, description, note }: PlaceholderSectionProps) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-400">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-50">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">{description}</p>
      <section className="mt-8 grid min-h-80 place-items-center rounded-xl border border-dashed border-zinc-800 bg-zinc-900/25 px-6 py-16 text-center"><div><div className="mx-auto h-2 w-2 rounded-full bg-violet-400 shadow-[0_0_18px_rgba(167,139,250,0.8)]" /><h2 className="mt-5 text-sm font-medium text-zinc-300">Ready for the next phase</h2><p className="mt-2 text-sm text-zinc-500">{note}</p></div></section>
    </div>
  );
}
