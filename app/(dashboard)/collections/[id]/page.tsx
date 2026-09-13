import { connection } from "next/server";
import { notFound } from "next/navigation";
import { requireUserPageSession } from "@/src/lib/auth";
import {
  browseUserCollectionCharacters,
  CustomCollectionNotFoundError,
} from "@/src/lib/collections/custom-collections";
import { CollectionDetailClient } from "@/components/collection-detail-client";

type Context = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CollectionDetailPage({ params, searchParams }: Context) {
  await connection();
  const principal = await requireUserPageSession();
  const { id } = await params;
  const sp = await searchParams;

  const rawQuery = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const rawSort = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort;
  const rawPage = Array.isArray(sp.page) ? sp.page[0] : sp.page;

  const query = rawQuery?.trim() || undefined;
  const sort = rawSort === "freshest" || rawSort === "name" || rawSort === "added" ? rawSort : "added";
  const page = rawPage ? parseInt(rawPage, 10) : 1;

  let browse;
  try {
    browse = await browseUserCollectionCharacters(principal, id, {
      query,
      sort,
      page,
      limit: 50,
    });
  } catch (error) {
    if (error instanceof CustomCollectionNotFoundError) {
      notFound();
    }
    throw error;
  }

  return (
    <CollectionDetailClient
      collection={browse.collection}
      characters={browse.items}
      total={browse.total}
      page={browse.page}
      totalPages={browse.totalPages}
      query={query}
      sort={sort}
    />
  );
}
