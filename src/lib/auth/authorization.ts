import type { Prisma } from "@/generated/prisma/client";
import type { AuthenticatedPrincipal } from "./session";

export const INITIAL_ADMIN_USER_ID = "initial-admin";

export function visibleCharacterWhere(
  principal: AuthenticatedPrincipal,
): Prisma.CharacterWhereInput {
  return principal.role === "ADMIN"
    ? { status: { not: "DELETED" } }
    : { status: "ACTIVE", publishedAt: { not: null } };
}
