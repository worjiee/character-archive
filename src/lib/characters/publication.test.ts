import type { Prisma } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { favoriteCreatorNotificationDedupeKey, publishCharacterWithFavoriteCreatorNotifications } from "./publication";

const CREATED_AT = new Date("2026-09-10T10:00:00.000Z");
const PUBLISHED_AT = new Date("2026-09-10T10:05:00.000Z");

describe("Favorite Creator publication notifications", () => {
  it("publishes once and creates one deduplicated notification per eligible follower", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const followers = vi.fn().mockResolvedValue([{ userId: "member-1" }, { userId: "admin-1" }]);
    const tx = {
      character: {
        updateMany,
        findUnique: vi.fn().mockResolvedValue({
          id: "character-1", name: "James", nameOverride: null, createdAt: CREATED_AT,
          sources: [{ platform: "JANITOR_AI", externalCreatorId: "creator-1", creatorName: "SEPHA" }],
        }),
      },
      userFavoriteCreator: { findMany: followers },
      notification: { createMany },
    } as unknown as Prisma.TransactionClient;

    await expect(publishCharacterWithFavoriteCreatorNotifications(tx, "character-1", PUBLISHED_AT)).resolves.toEqual({ published: true, notificationCount: 2 });
    await expect(publishCharacterWithFavoriteCreatorNotifications(tx, "character-1", PUBLISHED_AT)).resolves.toEqual({ published: false, notificationCount: 0 });
    expect(followers).toHaveBeenCalledTimes(1);
    expect(followers.mock.calls[0]![0]).toMatchObject({ where: { identityValue: "creator-1", createdAt: { lte: CREATED_AT }, user: { accessStatus: "ACTIVE" } } });
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]![0].data).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientUserId: "member-1", title: "SEPHA added a new character", body: "James", href: "/characters/character-1", dedupeKey: favoriteCreatorNotificationDedupeKey("member-1", "character-1") }),
    ]));
  });

  it("does not fan out when first publication was already claimed", async () => {
    const tx = {
      character: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn() },
      userFavoriteCreator: { findMany: vi.fn() },
      notification: { createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;
    await publishCharacterWithFavoriteCreatorNotifications(tx, "character-1", PUBLISHED_AT);
    expect(tx.character.findUnique).not.toHaveBeenCalled();
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });

  it("uses distinct dedupe keys for each recipient and stable keys for retries", () => {
    const first = favoriteCreatorNotificationDedupeKey("member-1", "character-1");
    expect(first).toBe(favoriteCreatorNotificationDedupeKey("member-1", "character-1"));
    expect(first).not.toBe(favoriteCreatorNotificationDedupeKey("member-2", "character-1"));
    expect(first.length).toBeLessThanOrEqual(191);
  });
});
