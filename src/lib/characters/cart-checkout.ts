import { strToU8, zipSync, type Zippable } from "fflate";
import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../auth";
import { resolveCartAuthor, type CartAuthorIdentity } from "./cart-groups";
import {
  CHARACTER_CART_CHECKOUT_FORMAT,
  CHARACTER_CART_CHECKOUT_FILENAME,
  CHARACTER_CART_CHECKOUT_MAX_CHARACTERS,
  CHARACTER_CART_CHECKOUT_MAX_UNCOMPRESSED_BYTES,
  CHARACTER_CART_CHECKOUT_VERSION,
} from "./cart-checkout-constants";
import {
  CHARACTER_EXPORT_SELECT,
  toCharacterExportDto,
  type CharacterExportDto,
} from "./export";

export { CHARACTER_CART_CHECKOUT_FILENAME };

export class CharacterCartCheckoutValidationError extends Error {}
export class CharacterCartCheckoutSizeError extends Error {}

export interface CharacterCartCheckoutItem {
  id: string;
  export: CharacterExportDto;
  author: CartAuthorIdentity;
}

export interface CharacterCartCheckoutManifest {
  format: typeof CHARACTER_CART_CHECKOUT_FORMAT;
  version: typeof CHARACTER_CART_CHECKOUT_VERSION;
  exportedAt: string;
  exportedBy: string;
  characterCount: number;
  authorCount: number;
  authors: Array<{
    name: string;
    characterCount: number;
    sourcePlatform: string | null;
  }>;
  characters: Array<{
    id: string;
    name: string;
    author: string;
    sourcePlatform: string | null;
    path: string;
  }>;
}

const CHARACTER_CART_CHECKOUT_SELECT = {
  id: true,
  ...CHARACTER_EXPORT_SELECT,
} satisfies Prisma.CharacterSelect;

export function parseCharacterCartCheckoutBody(value: unknown): string[] {
  if (!isPlainObject(value)) {
    throw new CharacterCartCheckoutValidationError("Request body must be an object.");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "characterIds") {
    throw new CharacterCartCheckoutValidationError("Request must contain only characterIds.");
  }
  if (!Array.isArray(value.characterIds) || value.characterIds.length === 0) {
    throw new CharacterCartCheckoutValidationError("characterIds must be a non-empty array.");
  }
  if (value.characterIds.length > CHARACTER_CART_CHECKOUT_MAX_CHARACTERS) {
    throw new CharacterCartCheckoutValidationError(
      `A maximum of ${CHARACTER_CART_CHECKOUT_MAX_CHARACTERS} characters can be checked out at once.`,
    );
  }
  const ids = value.characterIds.map((id) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
      throw new CharacterCartCheckoutValidationError("characterIds contains an invalid Character ID.");
    }
    return id;
  });
  if (new Set(ids).size !== ids.length) {
    throw new CharacterCartCheckoutValidationError("characterIds must not contain duplicates.");
  }
  return ids;
}

export async function getCharacterCartCheckoutItems(
  principal: AuthenticatedPrincipal,
  characterIds: readonly string[],
  client?: PrismaClient,
): Promise<CharacterCartCheckoutItem[]> {
  if (characterIds.length === 0 || characterIds.length > CHARACTER_CART_CHECKOUT_MAX_CHARACTERS) {
    throw new CharacterCartCheckoutValidationError(
      `Select between 1 and ${CHARACTER_CART_CHECKOUT_MAX_CHARACTERS} characters.`,
    );
  }
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const cartRows = await database.characterCartItem.findMany({
    where: {
      userId: principal.userId,
      characterId: { in: [...characterIds] },
      character: visibleCharacterWhere(principal),
    },
    select: { character: { select: CHARACTER_CART_CHECKOUT_SELECT } },
  });

  return cartRows.map(({ character }) => ({
    id: character.id,
    export: toCharacterExportDto(character),
    author: resolveCartAuthor(character.sources),
  }));
}

export function createCharacterCartCheckoutZip(
  items: readonly CharacterCartCheckoutItem[],
  principal: AuthenticatedPrincipal,
  exportedAt = new Date(),
): { bytes: Uint8Array; manifest: CharacterCartCheckoutManifest } {
  if (items.length === 0 || items.length > CHARACTER_CART_CHECKOUT_MAX_CHARACTERS) {
    throw new CharacterCartCheckoutValidationError(
      `Select between 1 and ${CHARACTER_CART_CHECKOUT_MAX_CHARACTERS} characters.`,
    );
  }

  const orderedItems = [...items].sort(compareCheckoutItems);
  const grouped = groupCheckoutItems(orderedItems);
  const archive: Zippable = {};
  const manifestCharacters: CharacterCartCheckoutManifest["characters"] = [];
  const manifestAuthors: CharacterCartCheckoutManifest["authors"] = [];
  const usedAuthorFolders = new Set<string>(["unknown-author"]);
  let uncompressedBytes = 0;

  for (const group of grouped) {
    const platformSuffix = sanitizeArchivePathSegment(group.author.platform ?? "source", "source");
    const authorFolder = group.author.unknown
      ? "unknown-author"
      : reservePathSegment(
        sanitizeArchivePathSegment(group.author.name, "author"),
        usedAuthorFolders,
        platformSuffix,
      );
    usedAuthorFolders.add(authorFolder);
    const usedCharacterFolders = new Set<string>();
    manifestAuthors.push({
      name: group.author.name,
      characterCount: group.items.length,
      sourcePlatform: group.author.platform,
    });

    for (const item of group.items) {
      const characterFolder = reservePathSegment(
        sanitizeArchivePathSegment(item.export.character.name, "character"),
        usedCharacterFolders,
        shortStableHash(item.id),
      );
      usedCharacterFolders.add(characterFolder);
      const path = `authors/${authorFolder}/${characterFolder}/character.json`;
      const content = `${JSON.stringify(item.export, null, 2)}\n`;
      const data = strToU8(content);
      uncompressedBytes += data.byteLength;
      assertCheckoutSize(uncompressedBytes);
      archive[path] = [data, { level: 6, mtime: exportedAt }];
      manifestCharacters.push({
        id: item.id,
        name: item.export.character.name,
        author: group.author.name,
        sourcePlatform: group.author.platform,
        path,
      });
    }
  }

  const manifest: CharacterCartCheckoutManifest = {
    format: CHARACTER_CART_CHECKOUT_FORMAT,
    version: CHARACTER_CART_CHECKOUT_VERSION,
    exportedAt: exportedAt.toISOString(),
    exportedBy: principal.displayName?.trim() || principal.username,
    characterCount: orderedItems.length,
    authorCount: grouped.length,
    authors: manifestAuthors,
    characters: manifestCharacters,
  };
  const manifestData = strToU8(`${JSON.stringify(manifest, null, 2)}\n`);
  assertCheckoutSize(uncompressedBytes + manifestData.byteLength);
  archive["manifest.json"] = [manifestData, { level: 6, mtime: exportedAt }];

  return { bytes: zipSync(archive, { level: 6 }), manifest };
}

export function sanitizeArchivePathSegment(value: string, fallback: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/gu, "-")
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[. _-]+|[. _-]+$/gu, "")
    .replace(/[-_.]{2,}/gu, "-")
    .slice(0, 64)
    .replace(/[. _-]+$/gu, "");
  const safe = stem || `${fallback}-${shortStableHash(value)}`;
  return isReservedFilenameStem(safe) ? `${fallback}-${safe}` : safe;
}

function groupCheckoutItems(items: readonly CharacterCartCheckoutItem[]) {
  const groups = new Map<string, { author: CartAuthorIdentity; items: CharacterCartCheckoutItem[] }>();
  for (const item of items) {
    const group = groups.get(item.author.key) ?? { author: item.author, items: [] };
    group.items.push(item);
    groups.set(item.author.key, group);
  }
  return [...groups.values()].sort((left, right) => compareAuthors(left.author, right.author));
}

function compareCheckoutItems(left: CharacterCartCheckoutItem, right: CharacterCartCheckoutItem): number {
  return compareAuthors(left.author, right.author)
    || compareText(left.export.character.name, right.export.character.name)
    || left.id.localeCompare(right.id);
}

function compareAuthors(left: CartAuthorIdentity, right: CartAuthorIdentity): number {
  if (left.unknown !== right.unknown) return left.unknown ? 1 : -1;
  return compareText(left.name, right.name)
    || (left.platform ?? "").localeCompare(right.platform ?? "")
    || left.key.localeCompare(right.key);
}

function compareText(left: string, right: string): number {
  return left.normalize("NFKC").localeCompare(right.normalize("NFKC"), "en", {
    numeric: true,
    sensitivity: "base",
  }) || left.localeCompare(right);
}

function reservePathSegment(base: string, used: ReadonlySet<string>, suffix: string): string {
  if (!used.has(base)) return base;
  const suffixed = `${base}-${suffix}`.slice(0, 72).replace(/[. _-]+$/gu, "");
  if (!used.has(suffixed)) return suffixed;
  let counter = 2;
  while (used.has(`${suffixed}-${counter}`)) counter += 1;
  return `${suffixed}-${counter}`;
}

function shortStableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(-7);
}

function assertCheckoutSize(bytes: number): void {
  if (bytes > CHARACTER_CART_CHECKOUT_MAX_UNCOMPRESSED_BYTES) {
    throw new CharacterCartCheckoutSizeError("The selected character data is too large for one checkout.");
  }
}

function isReservedFilenameStem(stem: string): boolean {
  return /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/iu.test(stem);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
