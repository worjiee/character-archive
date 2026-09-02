import { connection } from "next/server";
import { CollectionBrowseToolbar } from "@/components/collection-browse-toolbar";
import { CollectionCharacterGrid } from "@/components/collection-character-grid";
import { CollectionPageHeader } from "@/components/collection-page-header";
import { requireUserPageSession } from "@/src/lib/auth";
import {
  browseCollectionCharacters,
  parseCharacterCollectionBrowseInput,
} from "@/src/lib/characters/collections";

export default async function FavoritesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const principal = await requireUserPageSession();
  const filters = parseCharacterCollectionBrowseInput(await searchParams);
  const browse = await browseCollectionCharacters(principal, "favorites", filters);
  return (
    <div className="characters-page-shell">
      <CollectionPageHeader collection="favorites" />
      <CollectionBrowseToolbar filters={filters} />
      <CollectionCharacterGrid
        collection="favorites"
        characters={browse.items}
        filtered={Boolean(filters.query)}
        limited={browse.limited}
      />
    </div>
  );
}
