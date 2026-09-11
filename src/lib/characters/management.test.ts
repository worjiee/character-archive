import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
const publication = vi.hoisted(() => ({ publishCharacterWithFavoriteCreatorNotifications: vi.fn().mockResolvedValue({ published: true, notificationCount: 0 }) }));
vi.mock("./publication", () => publication);
import {
  bulkSoftDeleteCharacters,
  CharacterManagementNotFoundError,
  CharacterManagementValidationError,
  reorderGreetings,
  restoreDeletedCharacter,
  setManagedCharacterStatus,
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
    expect(updateMany.mock.calls[0][0].data).not.toHaveProperty("publishedAt");
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
        findUnique: vi.fn().mockResolvedValue({ status: "DELETED", statusBeforeDelete: "QUARANTINED", publishedAt: null }),
        update,
      },
    });
    await restoreDeletedCharacter("character-1", client);
    expect(update).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: { status: "QUARANTINED", statusBeforeDelete: null },
    });
  });

  it("publishes once when a never-published restricted character is approved", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: {
        findUnique: vi.fn().mockResolvedValue({ status: "QUARANTINED", publishedAt: null }),
        update,
      },
    });

    await setManagedCharacterStatus("character-1", "ACTIVE", client);

    expect(update).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: {
        status: "ACTIVE",
        blockedReason: null,
        lastCheckedAt: expect.any(Date),
      },
    });
    expect(publication.publishCharacterWithFavoriteCreatorNotifications).toHaveBeenCalledWith(expect.anything(), "character-1");
  });

  it("preserves the original publication timestamp across restriction and reactivation", async () => {
    const publishedAt = new Date("2026-08-20T09:00:00.000Z");
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: {
        findUnique: vi.fn().mockResolvedValue({ status: "QUARANTINED", publishedAt }),
        update,
      },
    });

    await setManagedCharacterStatus("character-1", "ACTIVE", client);

    expect(update.mock.calls[0][0].data).not.toHaveProperty("publishedAt");
  });

  it("restores a previously published deletion without republishing it", async () => {
    const publishedAt = new Date("2026-08-20T09:00:00.000Z");
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: {
        findUnique: vi.fn().mockResolvedValue({
          status: "DELETED",
          statusBeforeDelete: "ACTIVE",
          publishedAt,
        }),
        update,
      },
    });

    await restoreDeletedCharacter("character-1", client);

    expect(update).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: { status: "ACTIVE", statusBeforeDelete: null },
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

  describe("bulkSoftDeleteCharacters", () => {
    it("rejects non-array or empty characterIds input", async () => {
      await expect(bulkSoftDeleteCharacters(null)).rejects.toThrow(CharacterManagementValidationError);
      await expect(bulkSoftDeleteCharacters([])).rejects.toThrow(CharacterManagementValidationError);
      await expect(bulkSoftDeleteCharacters("character-1")).rejects.toThrow(CharacterManagementValidationError);
    });

    it("rejects invalid character ID formats or batch size exceeding limit", async () => {
      await expect(bulkSoftDeleteCharacters(["valid-id", "../malicious"])).rejects.toThrow(CharacterManagementValidationError);
      const oversized = Array.from({ length: 101 }, (_, i) => `char-${i}`);
      await expect(bulkSoftDeleteCharacters(oversized)).rejects.toThrow(CharacterManagementValidationError);
    });

    it("rejects when any target character does not exist in the database without performing mutations", async () => {
      const update = vi.fn().mockResolvedValue({});
      const client = transactionClient({
        character: {
          findMany: vi.fn().mockResolvedValue([
            { id: "char-1", status: "ACTIVE" },
          ]),
          update,
        },
      });

      await expect(bulkSoftDeleteCharacters(["char-1", "char-missing"], client)).rejects.toThrow(CharacterManagementNotFoundError);
      expect(update).not.toHaveBeenCalled();
    });

    it("atomically soft deletes eligible characters preserving prior status", async () => {
      const update = vi.fn().mockResolvedValue({});
      const client = transactionClient({
        character: {
          findMany: vi.fn().mockResolvedValue([
            { id: "char-1", status: "ACTIVE" },
            { id: "char-2", status: "QUARANTINED" },
          ]),
          update,
        },
      });

      const result = await bulkSoftDeleteCharacters(["char-1", "char-2"], client);
      expect(result).toEqual({
        success: true,
        deletedCount: 2,
        deletedIds: ["char-1", "char-2"],
        alreadyDeletedIds: [],
      });
      expect(update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { statusBeforeDelete: "ACTIVE", status: "DELETED" },
      });
      expect(update).toHaveBeenCalledWith({
        where: { id: "char-2" },
        data: { statusBeforeDelete: "QUARANTINED", status: "DELETED" },
      });
    });

    it("deduplicates repeated IDs in the input", async () => {
      const update = vi.fn().mockResolvedValue({});
      const client = transactionClient({
        character: {
          findMany: vi.fn().mockResolvedValue([
            { id: "char-1", status: "ACTIVE" },
          ]),
          update,
        },
      });

      const result = await bulkSoftDeleteCharacters(["char-1", "char-1"], client);
      expect(result).toEqual({
        success: true,
        deletedCount: 1,
        deletedIds: ["char-1"],
        alreadyDeletedIds: [],
      });
      expect(update).toHaveBeenCalledTimes(1);
    });

    it("idempotently handles already-deleted characters as a no-op", async () => {
      const update = vi.fn().mockResolvedValue({});
      const client = transactionClient({
        character: {
          findMany: vi.fn().mockResolvedValue([
            { id: "char-1", status: "ACTIVE" },
            { id: "char-2", status: "DELETED" },
          ]),
          update,
        },
      });

      const result = await bulkSoftDeleteCharacters(["char-1", "char-2"], client);
      expect(result).toEqual({
        success: true,
        deletedCount: 1,
        deletedIds: ["char-1"],
        alreadyDeletedIds: ["char-2"],
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        where: { id: "char-1" },
        data: { statusBeforeDelete: "ACTIVE", status: "DELETED" },
      });
    });
  });
});
