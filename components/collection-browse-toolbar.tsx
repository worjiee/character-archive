import Link from "next/link";
import type { CharacterCollectionBrowseInput } from "../src/lib/characters/collections";

export function CollectionBrowseToolbar({ filters }: { filters: CharacterCollectionBrowseInput }) {
  return (
    <form action="/favorites" method="get" role="search" aria-label="Search Favorites" className="collection-browse-toolbar">
      <label className="collection-search-field">
        <span className="sr-only">Search favorites</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="11" cy="11" r="7" />
          <path d="m16.5 16.5 4 4" />
        </svg>
        <input
          type="search"
          name="q"
          defaultValue={filters.query}
          placeholder="Search favorites..."
          maxLength={80}
          className="archive-focus"
        />
      </label>
      <label className="collection-sort-field">
        <span className="sr-only">Sort favorites</span>
        <select name="sort" defaultValue={filters.sort} className="archive-focus">
          <option value="freshest">Freshest</option>
          <option value="saved">Recently saved</option>
        </select>
      </label>
      <button type="submit" className="archive-button-secondary archive-focus">Apply</button>
      {(filters.query || filters.sort !== "freshest") && <Link href="/favorites" className="collection-clear-link archive-focus">Clear</Link>}
    </form>
  );
}
