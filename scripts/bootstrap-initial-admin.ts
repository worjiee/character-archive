import "dotenv/config";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "../lib/prisma";
import {
  getInitialAdminBootstrapConfig,
  INITIAL_ADMIN_USER_ID,
  normalizeUsername,
  validatePasswordHash,
} from "../src/lib/auth";

async function main(): Promise<void> {
  const config = getInitialAdminBootstrapConfig();
  const normalizedUsername = normalizeUsername(config.username);
  if (!normalizedUsername) throw new Error("OWNER_USERNAME normalizes to an empty value.");
  validatePasswordHash(config.passwordHash);

  const outcome = await prisma.$transaction(async (transaction) => {
    const userCount = await transaction.user.count();
    const byId = await transaction.user.findUnique({ where: { id: INITIAL_ADMIN_USER_ID } });
    const byUsername = await transaction.user.findUnique({ where: { normalizedUsername } });

    if (!byId && !byUsername) {
      if (userCount !== 0) {
        throw new Error("Initial administrator bootstrap aborted: another user already exists.");
      }
      await transaction.user.create({
        data: {
          id: INITIAL_ADMIN_USER_ID,
          username: config.username,
          normalizedUsername,
          displayName: config.username,
          passwordHash: config.passwordHash,
          role: "ADMIN",
          accessStatus: "ACTIVE",
        },
      });
      return "created" as const;
    }

    if (!byId || !byUsername || byId.id !== byUsername.id) {
      throw new Error("Initial administrator bootstrap aborted: user identity conflicts with the configured username.");
    }
    const matches = byId.id === INITIAL_ADMIN_USER_ID
      && byId.username === config.username
      && byId.normalizedUsername === normalizedUsername
      && byId.displayName === config.username
      && byId.passwordHash === config.passwordHash
      && byId.role === "ADMIN"
      && byId.accessStatus === "ACTIVE";
    if (!matches || userCount !== 1) {
      throw new Error("Initial administrator bootstrap aborted: the existing record does not exactly match the bootstrap configuration.");
    }
    return "unchanged" as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  console.log(outcome === "created"
    ? `Created initial administrator '${config.username}'.`
    : `Initial administrator '${config.username}' already matches the bootstrap configuration.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Initial administrator bootstrap failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
