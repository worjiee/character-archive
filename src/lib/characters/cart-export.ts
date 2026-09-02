import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere } from "../auth/authorization";
import type { AuthenticatedPrincipal } from "../auth/session";
import {
  CHARACTER_EXPORT_SELECT,
  type CharacterExportDto,
  toCharacterExportDto,
} from "./export";

export const CHARACTER_CART_EXPORT_SCHEMA = "character-archive.normalized-character-cart";
export const CHARACTER_CART_EXPORT_VERSION = 1;
export const CHARACTER_CART_EXPORT_FILENAME = "character-archive-cart.json";

export interface CharacterCartExportDto {
  schema: typeof CHARACTER_CART_EXPORT_SCHEMA;
  version: typeof CHARACTER_CART_EXPORT_VERSION;
  characters: CharacterExportDto["character"][];
}

const CART_EXPORT_SELECT = {
  character: { select: CHARACTER_EXPORT_SELECT },
} satisfies Prisma.CharacterCartItemSelect;

export async function getCharacterCartExport(
  principal: AuthenticatedPrincipal,
  characterIds?: readonly string[],
  client?: PrismaClient,
): Promise<CharacterCartExportDto> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const records = await database.characterCartItem.findMany({
    where: {
      userId: principal.userId,
      ...(characterIds ? { characterId: { in: [...characterIds] } } : {}),
      character: visibleCharacterWhere(principal),
    },
    orderBy: [{ createdAt: "desc" }, { characterId: "asc" }],
    select: CART_EXPORT_SELECT,
  });

  return {
    schema: CHARACTER_CART_EXPORT_SCHEMA,
    version: CHARACTER_CART_EXPORT_VERSION,
    characters: records.map(({ character }) => toCharacterExportDto(character).character),
  };
}
