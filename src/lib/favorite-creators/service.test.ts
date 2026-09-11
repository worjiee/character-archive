import { FavoriteCreatorProvenance, type PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { parseFavoriteCreatorIdentity, setFavoriteCreatorClaim, setManualFavoriteCreator } from "./service";

const identity = { platform: "JANITOR_AI" as const, kind: "EXTERNAL_ID" as const, value: "creator-1" };

describe("Favorite Creator identity and provenance", () => {
  it("normalizes fallback names while preserving stable IDs", () => {
    expect(parseFavoriteCreatorIdentity({ platform: "JANITOR_AI", identityKind: "CREATOR_NAME", identityValue: "  Thé   Creator " })).toEqual({ platform: "JANITOR_AI", kind: "CREATOR_NAME", value: "thé creator" });
    expect(parseFavoriteCreatorIdentity({ platform: "JANITOR_AI", identityKind: "EXTERNAL_ID", identityValue: "  Case-ID " })).toEqual({ platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "Case-ID" });
  });

  it("keeps the effective favorite while a DataCat claim survives manual removal", async () => {
    const database = memoryFavoriteDatabase();
    await setManualFavoriteCreator("user-1", identity, true, database.client);
    await setManualFavoriteCreator("user-1", identity, true, database.client);
    await setFavoriteCreatorClaim("user-1", identity, FavoriteCreatorProvenance.DATACAT, true, database.client);
    const result = await setManualFavoriteCreator("user-1", identity, false, database.client);
    expect(result).toEqual({ present: true, provenance: ["DATACAT"] });
    expect(database.parents).toHaveLength(1);
    expect(database.claims).toEqual([{ favoriteCreatorId: "favorite-1", provenance: "DATACAT" }]);
  });

  it("deletes the parent after the final claim is removed", async () => {
    const database = memoryFavoriteDatabase();
    await setManualFavoriteCreator("user-1", identity, true, database.client);
    await setManualFavoriteCreator("user-1", identity, false, database.client);
    expect(database.parents).toHaveLength(0);
    expect(database.claims).toHaveLength(0);
  });
});

function memoryFavoriteDatabase() {
  const parents: Array<{ id: string; userId: string; platform: string; identityKind: string; identityValue: string }> = [];
  const claims: Array<{ favoriteCreatorId: string; provenance: string }> = [];
  type KeyWhere = { userId_platform_identityKind_identityValue: { userId: string; platform: string; identityKind: string; identityValue: string } };
  const keyMatch = (where: KeyWhere) => {
    const key = where.userId_platform_identityKind_identityValue;
    return parents.find((row) => row.userId === key.userId && row.platform === key.platform && row.identityKind === key.identityKind && row.identityValue === key.identityValue);
  };
  const tx = {
    userFavoriteCreator: {
      upsert: vi.fn(async ({ where, create }: { where: KeyWhere; create: Omit<(typeof parents)[number], "id"> }) => keyMatch(where) ?? (parents.push({ id: `favorite-${parents.length + 1}`, ...create }), parents.at(-1))),
      findUnique: vi.fn(async ({ where, select }: { where: KeyWhere; select: { id?: boolean; claims?: unknown } }) => {
        const parent = keyMatch(where); if (!parent) return null;
        return select.claims ? { claims: claims.filter((claim) => claim.favoriteCreatorId === parent.id).sort((a, b) => a.provenance.localeCompare(b.provenance)) } : { id: parent.id };
      }),
      deleteMany: vi.fn(async ({ where }: { where: { id: string } }) => { const index = parents.findIndex(({ id }) => id === where.id); if (index < 0 || claims.some((claim) => claim.favoriteCreatorId === where.id)) return { count: 0 }; parents.splice(index, 1); return { count: 1 }; }),
    },
    userFavoriteCreatorClaim: {
      upsert: vi.fn(async ({ create }: { create: (typeof claims)[number] }) => { if (!claims.some((claim) => claim.favoriteCreatorId === create.favoriteCreatorId && claim.provenance === create.provenance)) claims.push(create); return create; }),
      deleteMany: vi.fn(async ({ where }: { where: (typeof claims)[number] }) => { const before = claims.length; for (let index = claims.length - 1; index >= 0; index--) if (claims[index]!.favoriteCreatorId === where.favoriteCreatorId && claims[index]!.provenance === where.provenance) claims.splice(index, 1); return { count: before - claims.length }; }),
    },
  };
  const client = { $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)) } as unknown as PrismaClient;
  return { client, parents, claims };
}
