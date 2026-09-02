import { Prisma, type CharacterStatus, type PrismaClient } from "../../../generated/prisma/client";

export class CharacterManagementValidationError extends Error {
  constructor(message: string) { super(message); this.name = "CharacterManagementValidationError"; }
}
export class CharacterManagementNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "CharacterManagementNotFoundError"; }
}

export interface CharacterOverrideInput {
  name: unknown;
  description: unknown;
  personality: unknown;
  scenario: unknown;
  avatarUrl: unknown;
}

export async function updateCharacterOverrides(
  id: string,
  input: CharacterOverrideInput,
  client?: PrismaClient,
): Promise<void> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const result = await database.character.updateMany({
    where: { id, status: { not: "DELETED" } },
    data: {
      nameOverride: requiredName(input.name),
      descriptionOverride: overrideText(input.description, "Description", 50_000),
      personalityOverride: overrideText(input.personality, "Personality", 50_000),
      scenarioOverride: overrideText(input.scenario, "Scenario", 50_000),
      avatarUrlOverride: overrideUrl(input.avatarUrl),
    },
  });
  if (result.count === 0) throw new CharacterManagementNotFoundError("Character not found.");
}

export async function clearCharacterOverrides(id: string, client?: PrismaClient): Promise<void> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const result = await database.character.updateMany({
    where: { id, status: { not: "DELETED" } },
    data: {
      nameOverride: null,
      descriptionOverride: null,
      personalityOverride: null,
      scenarioOverride: null,
      avatarUrlOverride: null,
    },
  });
  if (result.count === 0) throw new CharacterManagementNotFoundError("Character not found.");
}

export async function setManagedCharacterStatus(
  id: string,
  status: unknown,
  client?: PrismaClient,
): Promise<void> {
  if (status !== "ACTIVE" && status !== "QUARANTINED" && status !== "BLOCKED") {
    throw new CharacterManagementValidationError("Status must be ACTIVE, QUARANTINED, or BLOCKED.");
  }
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  await database.$transaction(async (tx) => {
    const character = await tx.character.findUnique({
      where: { id },
      select: { status: true, publishedAt: true },
    });
    if (!character || character.status === "DELETED") {
      throw new CharacterManagementNotFoundError("Character not found.");
    }
    await tx.character.update({
      where: { id },
      data: {
        status,
        ...(status === "ACTIVE"
          ? { blockedReason: null, publishedAt: character.publishedAt ?? new Date() }
          : {}),
        lastCheckedAt: new Date(),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function softDeleteCharacter(id: string, client?: PrismaClient): Promise<void> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  await database.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { id }, select: { status: true } });
    if (!character || character.status === "DELETED") {
      throw new CharacterManagementNotFoundError("Character not found.");
    }
    await tx.character.update({
      where: { id },
      data: { statusBeforeDelete: character.status, status: "DELETED" },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function restoreDeletedCharacter(id: string, client?: PrismaClient): Promise<void> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  await database.$transaction(async (tx) => {
    const character = await tx.character.findUnique({
      where: { id },
      select: { status: true, statusBeforeDelete: true, publishedAt: true },
    });
    if (!character || character.status !== "DELETED") {
      throw new CharacterManagementNotFoundError("Deleted character not found.");
    }
    const restoredStatus = validRestoredStatus(character.statusBeforeDelete);
    await tx.character.update({
      where: { id },
      data: {
        status: restoredStatus,
        statusBeforeDelete: null,
        ...(restoredStatus === "ACTIVE" && !character.publishedAt
          ? { publishedAt: new Date() }
          : {}),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reorderGreetings(
  characterId: string,
  greetingIds: unknown,
  client?: PrismaClient,
): Promise<void> {
  if (!Array.isArray(greetingIds) || greetingIds.some((id) => typeof id !== "string" || !id)) {
    throw new CharacterManagementValidationError("Greeting order must be an array of greeting IDs.");
  }
  if (new Set(greetingIds).size !== greetingIds.length) {
    throw new CharacterManagementValidationError("Greeting order cannot contain duplicate IDs.");
  }
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  await database.$transaction(async (tx) => {
    const existing = await tx.greeting.findMany({ where: { characterId }, select: { id: true } });
    const existingIds = new Set(existing.map((greeting) => greeting.id));
    if (existingIds.size !== greetingIds.length || greetingIds.some((id) => !existingIds.has(id))) {
      throw new CharacterManagementValidationError("Greeting order must include every greeting exactly once.");
    }
    for (const [localPosition, id] of greetingIds.entries()) {
      await tx.greeting.update({ where: { id }, data: { localPosition } });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setGreetingVisibility(
  characterId: string,
  greetingId: string,
  hidden: unknown,
  client?: PrismaClient,
): Promise<void> {
  if (typeof hidden !== "boolean") {
    throw new CharacterManagementValidationError("hidden must be a boolean.");
  }
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const result = await database.greeting.updateMany({
    where: { id: greetingId, characterId },
    data: { hidden },
  });
  if (result.count === 0) throw new CharacterManagementNotFoundError("Greeting not found.");
}

function requiredName(value: unknown): string {
  if (typeof value !== "string" || value.normalize("NFKC").trim().length === 0) {
    throw new CharacterManagementValidationError("Display name is required.");
  }
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (name.length > 200) throw new CharacterManagementValidationError("Display name is too long.");
  return name;
}

function overrideText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") throw new CharacterManagementValidationError(`${label} must be text.`);
  if (value.length > maximum) throw new CharacterManagementValidationError(`${label} is too long.`);
  return value.trim();
}

function overrideUrl(value: unknown): string {
  if (typeof value !== "string") throw new CharacterManagementValidationError("Avatar URL must be text.");
  const text = value.trim();
  if (!text) return "";
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  try {
    const url = new URL(text);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch { /* handled below */ }
  throw new CharacterManagementValidationError("Avatar URL must be HTTP(S) or a local path beginning with /.");
}

function validRestoredStatus(status: CharacterStatus | null): CharacterStatus {
  return status && status !== "DELETED" ? status : "ACTIVE";
}
