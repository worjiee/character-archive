import type { CharacterCardItem } from "./browse";
import { getSourceIdentity } from "../sources/presentation";

export const UNKNOWN_CART_AUTHOR_KEY = "unknown-author";
export const UNKNOWN_CART_AUTHOR_NAME = "Unknown author";

export interface CartAuthorIdentity {
  key: string;
  name: string;
  platform: string | null;
  platformLabel: string | null;
  externalCreatorId: string | null;
  unknown: boolean;
}

export interface CartAuthorGroup extends CartAuthorIdentity {
  characters: CharacterCardItem[];
  characterIds: string[];
}

interface AuthorSource {
  platform: string;
  creatorName: string | null;
  externalCreatorId?: string | null;
}

export function resolveCartAuthor(sources: readonly AuthorSource[]): CartAuthorIdentity {
  const source = sources.find((candidate) => clean(candidate.externalCreatorId) || clean(candidate.creatorName));
  if (!source) {
    return {
      key: UNKNOWN_CART_AUTHOR_KEY,
      name: UNKNOWN_CART_AUTHOR_NAME,
      platform: null,
      platformLabel: null,
      externalCreatorId: null,
      unknown: true,
    };
  }

  const creatorId = clean(source.externalCreatorId);
  const creatorName = clean(source.creatorName);
  const fallbackName = creatorId ?? UNKNOWN_CART_AUTHOR_NAME;
  const identity = creatorId
    ? `source:${source.platform}:creator:${creatorId}`
    : `source:${source.platform}:name:${normalizeAuthorSortKey(creatorName ?? fallbackName)}`;
  return {
    key: identity,
    name: creatorName ?? fallbackName,
    platform: source.platform,
    platformLabel: getSourceIdentity(source.platform).label,
    externalCreatorId: creatorId,
    unknown: false,
  };
}

export function groupCartCharacters(characters: readonly CharacterCardItem[]): CartAuthorGroup[] {
  const groups = new Map<string, { identity: CartAuthorIdentity; names: Set<string>; characters: CharacterCardItem[] }>();
  for (const character of characters) {
    const identity = resolveCartAuthor(character.sources);
    const group = groups.get(identity.key) ?? { identity, names: new Set<string>(), characters: [] };
    if (!identity.unknown) group.names.add(identity.name);
    group.characters.push(character);
    groups.set(identity.key, group);
  }

  return [...groups.values()]
    .map(({ identity, names, characters: groupedCharacters }) => {
      const charactersSorted = [...groupedCharacters].sort(compareCharacters);
      const name = identity.unknown
        ? UNKNOWN_CART_AUTHOR_NAME
        : [...names].sort(compareDisplayNames)[0] ?? identity.name;
      return {
        ...identity,
        name,
        characters: charactersSorted,
        characterIds: charactersSorted.map(({ id }) => id),
      };
    })
    .sort((left, right) => {
      if (left.unknown !== right.unknown) return left.unknown ? 1 : -1;
      return compareDisplayNames(left.name, right.name)
        || (left.platform ?? "").localeCompare(right.platform ?? "")
        || left.key.localeCompare(right.key);
    });
}

export function normalizeAuthorSortKey(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function compareCharacters(left: CharacterCardItem, right: CharacterCardItem): number {
  return compareDisplayNames(left.name, right.name) || left.id.localeCompare(right.id);
}

function compareDisplayNames(left: string, right: string): number {
  return normalizeAuthorSortKey(left).localeCompare(normalizeAuthorSortKey(right), "en", {
    numeric: true,
    sensitivity: "base",
  }) || left.localeCompare(right);
}

function clean(value: string | null | undefined): string | null {
  const cleaned = value?.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return cleaned || null;
}
