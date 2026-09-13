import { Suspense } from "react";
import { connection } from "next/server";
import { FreshHome, FreshHomeSkeleton } from "@/components/fresh-home";
import { getFreshPageData, parseFreshSearchParams } from "@/src/lib/home/fresh";
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
  const data = await getFreshPageData(filters, principal);
  return <FreshHome data={data} />;
}
