import type {
  CharacterBrowseFacets,
  CharacterBrowseInput,
} from "../src/lib/characters/browse";
import {
  getSourceIdentity,
  SOURCE_NAVIGATION_PLATFORM_KEYS,
  type PersistedSourcePlatform,
} from "../src/lib/sources/presentation";

export interface CharacterLibraryFilterOptions {
  tags: CharacterBrowseFacets["tags"];
  platforms: CharacterBrowseFacets["sources"];
  statuses: CharacterBrowseFacets["statuses"];
}

export type CharacterSourceNavigationKey = "ALL" | (typeof SOURCE_NAVIGATION_PLATFORM_KEYS)[number];

export interface CharacterSourceNavigationItem {
  key: CharacterSourceNavigationKey;
  label: string;
  count: number | null;
  disabled: boolean;
}

export interface ModalDialogHandle {
  readonly open: boolean;
  showModal(): void;
}

export function showModalWhenClosed(dialog: ModalDialogHandle): void {
  if (!dialog.open) dialog.showModal();
}

export function activeCharacterFilterCount(filters: CharacterBrowseInput): number {
  return Number(filters.query.trim().length > 0)
    + filters.tags.length
    + filters.sources.length
    + filters.statuses.length;
}

export function sourceFiltersForNavigation(
  key: CharacterSourceNavigationKey,
): PersistedSourcePlatform[] | null {
  if (key === "ALL") return [];
  if (key === "JANNY") return null;
  return [key];
}

export function selectedSourceNavigationKey(
  sources: readonly string[],
): CharacterSourceNavigationKey | null {
  if (sources.length === 0) return "ALL";
  if (sources.length !== 1) return null;
  const [source] = sources;
  return (SOURCE_NAVIGATION_PLATFORM_KEYS as readonly string[]).includes(source)
    && source !== "JANNY"
    ? source as CharacterSourceNavigationKey
    : null;
}

export function buildCharacterSourceNavigation(
  total: number,
  sourceFacets: CharacterBrowseFacets["sources"],
): CharacterSourceNavigationItem[] {
  const counts = new Map(sourceFacets.map((facet) => [facet.value, facet.count]));
  return [
    { key: "ALL", label: "All", count: total, disabled: false },
    ...SOURCE_NAVIGATION_PLATFORM_KEYS.map((key) => ({
      key,
      label: getSourceIdentity(key).label,
      count: key === "JANNY" ? null : counts.get(key) ?? 0,
      disabled: key === "JANNY",
    })),
  ];
}
