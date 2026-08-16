import "dotenv/config";
import { prisma } from "../lib/prisma";

async function checkDatabase(): Promise<void> {
  try {
    const characterCount = await prisma.character.count();
    console.log(JSON.stringify({ connected: true, characterCount }));
  } finally {
    await prisma.$disconnect();
  }
}

void checkDatabase();
