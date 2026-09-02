import { connection } from "next/server";
import { CartAuthorGroupedCollection } from "@/components/cart-author-grouped-collection";
import { requireUserPageSession } from "@/src/lib/auth";
import { groupCartCharacters } from "@/src/lib/characters/cart-groups";
import { browseCollectionCharacters } from "@/src/lib/characters/collections";

export default async function CartPage() {
  await connection();
  const principal = await requireUserPageSession();
  const browse = await browseCollectionCharacters(principal, "cart", { query: "", sort: "freshest" });
  return (
    <div className="characters-page-shell">
      <CartAuthorGroupedCollection
        groups={groupCartCharacters(browse.items)}
        limited={browse.limited}
      />
    </div>
  );
}
