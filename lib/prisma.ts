import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import { Pool } from "pg";

interface PrismaResources {
  pool: Pool;
  adapter: PrismaPg;
  prisma: PrismaClient;
}

const globalForPrisma = globalThis as typeof globalThis & {
  chikpeasPrismaResources?: PrismaResources;
};

function createPrismaResources(): PrismaResources {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  const pool = new Pool({ connectionString });
  // The pool is shared through globalThis during development, so a disposed
  // hot-reloaded adapter must not close it out from under the next module.
  const adapter = new PrismaPg(pool, { disposeExternalPool: false });
  const prisma = new PrismaClient({ adapter });

  return { pool, adapter, prisma };
}

const resources = globalForPrisma.chikpeasPrismaResources ?? createPrismaResources();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.chikpeasPrismaResources = resources;
}

export const prisma = resources.prisma;
