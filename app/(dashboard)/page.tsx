import { Suspense } from "react";
import { connection } from "next/server";
import { FreshHome, FreshHomeSkeleton } from "@/components/fresh-home";
import { getFreshPageData, parseFreshSearchParams } from "@/src/lib/home/fresh";
import { getRecentViews } from "@/src/lib/history/service";
import { requireUserPageSession } from "@/src/lib/auth";

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<FreshHomeSkeleton />}>
      <FreshPageContent searchParams={searchParams} />
    </Suspense>
  );
}

async function FreshPageContent({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await connection();
  const principal = await requireUserPageSession();
  const filters = parseFreshSearchParams(await searchParams);
  const [data, continueBrowsing] = await Promise.all([
    getFreshPageData(filters, principal),
    getRecentViews(principal, 6),
  ]);
  return <FreshHome data={data} continueBrowsing={continueBrowsing} />;
}
