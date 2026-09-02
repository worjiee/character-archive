export function PreviewImportUnavailable() {
  return (
    <section aria-labelledby="preview-import-heading" className="border-b border-zinc-800 bg-zinc-950/30 p-4 sm:p-5">
      <p className="archive-eyebrow">Client preview</p>
      <h1 id="preview-import-heading" className="mt-1 text-xl font-bold uppercase tracking-[-0.015em] text-zinc-50 sm:text-2xl">
        Import uploads are temporarily unavailable in this preview
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
        This preview focuses on browsing and review functionality while large artifact importing is prepared for production storage.
      </p>
    </section>
  );
}
