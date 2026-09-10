import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { prisma } from "../lib/prisma";

const phase = process.argv[2];
const snapshotPath = ".notification-preview-invariants.json";

type ForeignKey = { name: string; tableName: string; definition: string };
type Snapshot = {
  counts: { characters: number; artworkAssets: number; favorites: number; cart: number };
  foreignKeys: ForeignKey[];
};

async function inspect(): Promise<Snapshot> {
  const [characters, artworkAssets, favorites, cart, foreignKeys, invalidForeignKeys] = await Promise.all([
    prisma.character.count(),
    prisma.artworkAsset.count(),
    prisma.characterFavorite.count(),
    prisma.characterCartItem.count(),
    prisma.$queryRaw<ForeignKey[]>`
      SELECT c.conname AS name, c.conrelid::regclass::text AS "tableName", pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c
      WHERE c.connamespace = current_schema()::regnamespace AND c.contype = 'f'
      ORDER BY c.conname
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM pg_constraint c
      WHERE c.connamespace = current_schema()::regnamespace AND c.contype = 'f' AND NOT c.convalidated
    `,
  ]);
  if (invalidForeignKeys[0]?.count !== 0) throw new Error("Preview contains an unvalidated foreign-key relationship.");
  const counts = { characters, artworkAssets, favorites, cart };
  const expected = { characters: 355, artworkAssets: 354, favorites: 2, cart: 2 };
  if (JSON.stringify(counts) !== JSON.stringify(expected)) {
    throw new Error(`Preview invariant mismatch: ${JSON.stringify({ expected, actual: counts })}`);
  }
  return { counts, foreignKeys };
}

async function main(): Promise<void> {
  if (process.env.VERCEL_ENV !== "preview") throw new Error("Notification migration verification may run only in a Vercel Preview build.");
  const current = await inspect();
  if (phase === "before") {
    await writeFile(snapshotPath, JSON.stringify(current), "utf8");
    console.log(JSON.stringify({ phase, ...current.counts, validatedForeignKeys: current.foreignKeys.length }));
    return;
  }
  if (phase !== "after") throw new Error("Expected migration verification phase 'before' or 'after'.");
  const before = JSON.parse(await readFile(snapshotPath, "utf8")) as Snapshot;
  for (const constraint of before.foreignKeys) {
    if (!current.foreignKeys.some((candidate) => JSON.stringify(candidate) === JSON.stringify(constraint))) {
      throw new Error(`Existing relationship changed or disappeared: ${constraint.name}`);
    }
  }
  const notificationForeignKey = current.foreignKeys.find(({ name }) => name === "Notification_recipientUserId_fkey");
  if (!notificationForeignKey?.definition.includes("ON DELETE CASCADE")) throw new Error("Notification recipient cascade is missing.");
  const notificationCount = await prisma.notification.count();
  console.log(JSON.stringify({ phase, ...current.counts, notificationCount, validatedForeignKeys: current.foreignKeys.length }));
}

main().finally(async () => prisma.$disconnect());
