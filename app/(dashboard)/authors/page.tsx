import { connection } from "next/server";
import { AuthorLibrary } from "@/components/author-library";
import type { BrowseSearchParams } from "@/src/lib/archive/browse-params";
import { requireUserPageSession } from "@/src/lib/auth";
import { browseAuthors } from "@/src/lib/authors/browse";
import { parseAuthorBrowseParams } from "@/src/lib/authors/params";

export default async function AuthorsPage({ searchParams }: { searchParams: Promise<BrowseSearchParams> }) {
  await connection();
  const principal = await requireUserPageSession();
  const filters = parseAuthorBrowseParams(await searchParams);
  const browse = await browseAuthors(filters, principal);

  return (
    <div>
      <header className="border-b border-zinc-800/80 pb-5">
        <p className="archive-eyebrow">Source-scoped creators</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-[-0.025em] text-zinc-50 sm:text-[1.75rem]">Authors</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-zinc-400">Browse creators by their persisted source identity and open the characters associated with that source account.</p>
      </header>
      <AuthorLibrary browse={browse} filters={filters} />
    </div>
  );
}
