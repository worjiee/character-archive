import { createHash } from "node:crypto";
import {
  CreatorIdentityKind,
  NotificationCategory,
  type Prisma,
} from "../../../generated/prisma/client";
import { authorIdentityForSource } from "../authors/identity";
import { NOTIFICATION_UNREAD_RETENTION_MS } from "../notifications";

const FANOUT_BATCH_SIZE = 200;

export async function publishCharacterWithFavoriteCreatorNotifications(
  tx: Prisma.TransactionClient,
  characterId: string,
  publishedAt = new Date(),
): Promise<{ published: boolean; notificationCount: number }> {
  const claimed = await tx.character.updateMany({
    where: { id: characterId, status: "ACTIVE", publishedAt: null },
    data: { publishedAt },
  });
  if (claimed.count === 0) return { published: false, notificationCount: 0 };

  const character = await tx.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      nameOverride: true,
      createdAt: true,
      sources: {
        orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { platform: true, externalCreatorId: true, creatorName: true },
      },
    },
  });
  const source = character?.sources[0];
  if (!character || !source) return { published: true, notificationCount: 0 };
  const identity = authorIdentityForSource(source);
  if (!identity) return { published: true, notificationCount: 0 };

  const followers = await tx.userFavoriteCreator.findMany({
    where: {
      platform: identity.platform,
      identityKind: identity.kind === "EXTERNAL_ID"
        ? CreatorIdentityKind.EXTERNAL_ID
        : CreatorIdentityKind.CREATOR_NAME,
      identityValue: identity.value,
      createdAt: { lte: character.createdAt },
      user: { accessStatus: "ACTIVE" },
      claims: { some: {} },
    },
    select: { userId: true },
  });
  const creatorName = bounded(source.creatorName?.trim() || "A Favorite Creator", 120);
  const characterName = bounded(character.nameOverride?.trim() || character.name, 800);
  const expiresAt = new Date(publishedAt.getTime() + NOTIFICATION_UNREAD_RETENTION_MS);
  const rows = followers.map(({ userId }) => ({
    recipientUserId: userId,
    category: NotificationCategory.FAVORITE_CREATOR_NEW_CHARACTER,
    title: bounded(`${creatorName} added a new character`, 160),
    body: characterName,
    href: `/characters/${encodeURIComponent(character.id)}`,
    entityType: "Character",
    entityId: character.id,
    dedupeKey: favoriteCreatorNotificationDedupeKey(userId, character.id),
    createdAt: publishedAt,
    expiresAt,
  }));
  for (let offset = 0; offset < rows.length; offset += FANOUT_BATCH_SIZE) {
    await tx.notification.createMany({ data: rows.slice(offset, offset + FANOUT_BATCH_SIZE), skipDuplicates: true });
  }
  return { published: true, notificationCount: rows.length };
}

export function favoriteCreatorNotificationDedupeKey(userId: string, characterId: string): string {
  const digest = createHash("sha256").update(userId).update("\0").update(characterId).digest("hex");
  return `favorite-creator-new-character:${digest}`;
}

function bounded(value: string, maximum: number): string {
  const normalized = value.normalize("NFKC").trim();
  return normalized.length <= maximum ? normalized : normalized.slice(0, maximum - 1).trimEnd() + "…";
}
