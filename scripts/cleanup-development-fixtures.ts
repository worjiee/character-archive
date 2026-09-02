import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  DEVELOPMENT_FIXTURE_LOREBOOK_IDENTITIES,
  PROTECTED_REAL_LOREBOOK_EXTERNAL_IDS,
} from "../src/lib/importers/development/fixture-identities";
import { isDevelopmentFixtureEnabled } from "../src/lib/importers/development/availability";

const APPLY_FLAG = "--apply";

function assertLocalDatabaseTarget(connectionString: string | undefined): {
  host: string;
  port: string;
  database: string;
} {
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const target = new URL(connectionString);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !localHosts.has(target.hostname)
  ) {
    throw new Error("Development fixture cleanup is restricted to a local PostgreSQL database.");
  }

  return {
    host: target.hostname,
    port: target.port || "5432",
    database: target.pathname.replace(/^\//, ""),
  };
}

async function durableCounts() {
  // Keep these sequential: the local Prisma development daemon has a small
  // connection budget, and a count audit must not exhaust it before cleanup.
  const characters = await prisma.character.count();
  const artworkAssets = await prisma.artworkAsset.count();
  const favorites = await prisma.characterFavorite.count();
  const cartItems = await prisma.characterCartItem.count();
  const characterSources = await prisma.characterSource.count();
  const greetings = await prisma.greeting.count();
  const repositorySettings = await prisma.repositorySettings.count();
  const users = await prisma.user.count();
  const userSessions = await prisma.userSession.count();
  const importPreviewJobs = await prisma.importPreviewJob.count();
  const bridgePairings = await prisma.bridgePairing.count();
  const bridgeSessions = await prisma.bridgeSession.count();
  const bridgeJobs = await prisma.bridgeJob.count();
  const tags = await prisma.tag.count();
  const characterTags = await prisma.characterTag.count();
  const sourceTags = await prisma.sourceTag.count();
  const lorebooks = await prisma.lorebook.count();
  const characterLorebooks = await prisma.characterLorebook.count();
  const lorebookEntries = await prisma.lorebookEntry.count();
  const blockRules = await prisma.blockRule.count();
  const blockedCreators = await prisma.blockedCreator.count();
  const sourceConnections = await prisma.sourceConnection.count();

  return {
    characters,
    artworkAssets,
    favorites,
    cartItems,
    characterSources,
    greetings,
    repositorySettings,
    users,
    userSessions,
    importPreviewJobs,
    bridgePairings,
    bridgeSessions,
    bridgeJobs,
    tags,
    characterTags,
    sourceTags,
    lorebooks,
    characterLorebooks,
    lorebookEntries,
    blockRules,
    blockedCreators,
    sourceConnections,
  };
}

async function main(): Promise<void> {
  if (!isDevelopmentFixtureEnabled()) {
    throw new Error("Development fixture cleanup is disabled in production.");
  }

  const database = assertLocalDatabaseTarget(process.env.DATABASE_URL);
  const apply = process.argv.includes(APPLY_FLAG);
  const before = await durableCounts();
  const protectedLorebooks = await prisma.lorebook.findMany({
    where: {
      sourcePlatform: "JANITOR_AI",
      externalId: { in: [...PROTECTED_REAL_LOREBOOK_EXTERNAL_IDS] },
    },
    select: { id: true, externalId: true, title: true },
    orderBy: { externalId: "asc" },
  });
  const candidates = await prisma.lorebook.findMany({
    where: {
      OR: DEVELOPMENT_FIXTURE_LOREBOOK_IDENTITIES.map((identity) => ({
        sourcePlatform: identity.platform,
        externalId: identity.externalId,
      })),
    },
    select: {
      id: true,
      title: true,
      sourcePlatform: true,
      externalId: true,
      sourceUrl: true,
      _count: { select: { entries: true, characters: true } },
    },
    orderBy: { externalId: "asc" },
  });

  console.log(JSON.stringify({ database, mode: apply ? "apply" : "audit", before, protectedLorebooks, candidates }, null, 2));

  if (!apply) {
    console.log(`Audit only. Re-run with ${APPLY_FLAG} to remove the exact allowlisted fixture rows.`);
    return;
  }

  await prisma.$transaction(
    async (transaction) => {
      for (const identity of DEVELOPMENT_FIXTURE_LOREBOOK_IDENTITIES) {
        const candidate = await transaction.lorebook.findUnique({
          where: {
            sourcePlatform_externalId: {
              sourcePlatform: identity.platform,
              externalId: identity.externalId,
            },
          },
          select: { id: true, _count: { select: { characters: true } } },
        });

        if (!candidate) continue;
        if (candidate._count.characters !== 0) {
          throw new Error(
            `Refusing to delete fixture ${identity.platform}/${identity.externalId}: it is linked to a Character.`,
          );
        }

        await transaction.lorebook.delete({
          where: {
            sourcePlatform_externalId: {
              sourcePlatform: identity.platform,
              externalId: identity.externalId,
            },
          },
        });
      }
    },
    { isolationLevel: "Serializable" },
  );

  const after = await durableCounts();
  const remainingCandidates = await prisma.lorebook.count({
    where: {
      OR: DEVELOPMENT_FIXTURE_LOREBOOK_IDENTITIES.map((identity) => ({
        sourcePlatform: identity.platform,
        externalId: identity.externalId,
      })),
    },
  });
  const protectedRemaining = await prisma.lorebook.count({
    where: {
      sourcePlatform: "JANITOR_AI",
      externalId: { in: [...PROTECTED_REAL_LOREBOOK_EXTERNAL_IDS] },
    },
  });

  console.log(JSON.stringify({ after, remainingCandidates, protectedRemaining }, null, 2));
}

void main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Development fixture cleanup failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
