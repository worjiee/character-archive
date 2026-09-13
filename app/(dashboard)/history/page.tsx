import { connection } from "next/server";
import { requireUserPageSession } from "@/src/lib/auth";
import { getPaginatedHistory } from "@/src/lib/history/service";
import { HistoryPageClient } from "@/components/history-page-client";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const principal = await requireUserPageSession();
  const resolvedParams = await searchParams;

  const rawPage = typeof resolvedParams.page === "string" ? parseInt(resolvedParams.page, 10) : 1;
  const rawPageSize = typeof resolvedParams.pageSize === "string" ? parseInt(resolvedParams.pageSize, 10) : 24;

  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
  const pageSize = isNaN(rawPageSize) || rawPageSize < 1 ? 24 : rawPageSize;

  const initialData = await getPaginatedHistory(principal, page, pageSize);

  return <HistoryPageClient initialData={initialData} />;
}