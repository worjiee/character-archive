import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  reorderGreetings,
  restoreDeletedCharacter,
  setGreetingVisibility,
  softDeleteCharacter,
  updateCharacterOverrides,
} from "./management";

function transactionClient(tx: object) {
  return {
    $transaction: vi.fn(async (
      callback: (client: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => { void options; return callback(tx as Prisma.TransactionClient); }),
  } as unknown as PrismaClient;
}

describe("character management", () => {
  it("stores local overrides instead of changing imported source fields", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await updateCharacterOverrides("character-1", {
      name: "Local Theron",
      description: "Local description",
      personality: "Local personality",
      scenario: "Local scenario",
      avatarUrl: "/local-avatar.svg",
    }, { character: { updateMany } } as unknown as PrismaClient);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        nameOverride: "Local Theron",
        descriptionOverride: "Local description",
        personalityOverride: "Local personality",
        scenarioOverride: "Local scenario",
        avatarUrlOverride: "/local-avatar.svg",
      },
    }));
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("name");
  });

  it("soft deletes while remembering the prior moderation status", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: { findUnique: vi.fn().mockResolvedValue({ status: "BLOCKED" }), update },
    });
    await softDeleteCharacter("character-1", client);
    expect(update).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: { statusBeforeDelete: "BLOCKED", status: "DELETED" },
    });
  });

  it("restores a deleted character to its previous status", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: {
        findUnique: vi.fn().mockResolvedValue({ status: "DELETED", statusBeforeDelete: "QUARANTINED" }),
        update,
      },
    });
    await restoreDeletedCharacter("character-1", client);
    expect(update).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: { status: "QUARANTINED", statusBeforeDelete: null },
    });
  });

  it("reorders every greeting with local positions", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      greeting: {
        findMany: vi.fn().mockResolvedValue([{ id: "g1" }, { id: "g2" }]),
        update,
      },
    });
    await reorderGreetings("character-1", ["g2", "g1"], client);
    expect(update.mock.calls.map((call) => call[0])).toEqual([
      { where: { id: "g2" }, data: { localPosition: 0 } },
      { where: { id: "g1" }, data: { localPosition: 1 } },
    ]);
  });

  it("changes greeting visibility without modifying source content", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await setGreetingVisibility(
      "character-1",
      "greeting-1",
      true,
      { greeting: { updateMany } } as unknown as PrismaClient,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "greeting-1", characterId: "character-1" },
      data: { hidden: true },
    });
  });
});
