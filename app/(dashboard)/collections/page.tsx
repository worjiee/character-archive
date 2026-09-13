import { connection } from "next/server";
import { requireUserPageSession } from "@/src/lib/auth";
import { listUserCollections } from "@/src/lib/collections/custom-collections";
import { CollectionsIndexClient } from "@/components/collections-index-client";

export default async function CollectionsPage() {
  await connection();
  const principal = await requireUserPageSession();
  const collections = await listUserCollections(principal);

  return <CollectionsIndexClient initialCollections={collections} />;
}
