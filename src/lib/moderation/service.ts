import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type { NormalizedCharacter } from "../importers/types";
import {
  evaluateCharacterBlocklist,
  formatBlockedReason,
  normalizeForMatch,
  type FilterableCharacter,
  type ModerationBlockedCreator,
  type ModerationMatch,
  type ModerationPlatform,
  type ModerationResult,
  type ModerationRule,
  type ModerationRuleType,
} from "./matcher";

const RULE_TYPES: ModerationRuleType[] = [
  "CHARACTER_NAME", "CREATOR_NAME", "CREATOR_ID", "TAG", "KEYWORD",
];
const PLATFORMS: ModerationPlatform[] = ["JANITOR_AI", "SAUCEPAN", "DATACAT", "OTHER"];

const moderationCharacterSelect = {
  id: true,
  status: true,
  name: true,
  description: true,
  personality: true,
  scenario: true,
  exampleDialogs: true,
  greetings: { select: { content: true } },
  tags: { select: { tag: { select: { name: true, slug: true } } } },
  sources: {
    select: {
      platform: true,
      externalCreatorId: true,
      creatorName: true,
    },
  },
} satisfies Prisma.CharacterSelect;

type ModerationCharacterRow = Prisma.CharacterGetPayload<{
  select: typeof moderationCharacterSelect;
}>;

export interface ModerationCharacterRecord extends FilterableCharacter {
  id: string;
  status: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
}

export interface ModerationCriteria {
  rules: ModerationRule[];
  blockedCreators: ModerationBlockedCreator[];
}

export interface ModerationSaveResult {
  moderation: ModerationResult;
  status: ModerationCharacterRecord["status"];
  blockedReason: string | null;
}

export interface BlockedDashboardData {
  rules: Array<ModerationRule & { createdAt: string }>;
  blockedCreators: Array<ModerationBlockedCreator & { reason: string | null; createdAt: string }>;
  quarantinedCharacters: Array<{
    id: string;
    name: string;
    avatarUrl: string | null;
    blockedReason: string | null;
    updatedAt: string;
    tags: Array<{ name: string; slug: string }>;
    sources: Array<{ platform: ModerationPlatform; creatorName: string | null }>;
  }>;
}

export class ModerationValidationError extends Error {
  constructor(message: string) { super(message); this.name = "ModerationValidationError"; }
}
export class ModerationConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ModerationConflictError"; }
}
export class ModerationNotFoundError extends Error {
  constructor(message: string) { super(message); this.name = "ModerationNotFoundError"; }
}

export async function evaluatePersistedCharacter(
  client: Prisma.TransactionClient,
  characterId: string,
): Promise<ModerationSaveResult> {
  const [row, criteria] = await Promise.all([
    client.character.findUnique({ where: { id: characterId }, select: moderationCharacterSelect }),
    loadModerationCriteria(client),
  ]);
  if (!row) throw new ModerationNotFoundError("Character not found during moderation.");

  const character = mapCharacterRow(row);
  const moderation = evaluateCharacterBlocklist(character, criteria.rules, criteria.blockedCreators);
  const blockedReason = formatBlockedReason(moderation.matches);
  let status = character.status;

  if (moderation.blocked && status === "ACTIVE") {
    await client.character.update({
      where: { id: characterId },
      data: { status: "QUARANTINED", blockedReason },
    });
    status = "QUARANTINED";
  } else if (moderation.blocked && status === "QUARANTINED") {
    await client.character.update({ where: { id: characterId }, data: { blockedReason } });
  }

  return { moderation, status, blockedReason: status === "QUARANTINED" ? blockedReason : null };
}

export async function getBlockedDashboardData(client?: PrismaClient): Promise<BlockedDashboardData> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const [rules, blockedCreators, quarantinedCharacters] = await Promise.all([
    database.blockRule.findMany({ orderBy: [{ createdAt: "desc" }, { value: "asc" }] }),
    database.blockedCreator.findMany({ orderBy: [{ createdAt: "desc" }, { creatorName: "asc" }] }),
    database.character.findMany({
      where: { status: "QUARANTINED" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, name: true, avatarUrl: true, blockedReason: true, updatedAt: true,
        tags: { select: { tag: { select: { name: true, slug: true } } } },
        sources: { select: { platform: true, creatorName: true } },
      },
    }),
  ]);

  return {
    rules: rules.map((rule) => ({ ...rule, createdAt: rule.createdAt.toISOString() })),
    blockedCreators: blockedCreators.map((creator) => ({ ...creator, createdAt: creator.createdAt.toISOString() })),
    quarantinedCharacters: quarantinedCharacters.map((character) => ({
      ...character,
      updatedAt: character.updatedAt.toISOString(),
      tags: character.tags.map(({ tag }) => tag),
    })),
  };
}

export async function createBlockRuleAndRecheck(
  input: { type: unknown; value: unknown },
  client?: PrismaClient,
): Promise<{ rule: ModerationRule; affectedCount: number }> {
  const type = parseRuleType(input.type);
  const value = parseRequiredText(input.value, "Rule value");

  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$transaction(async (tx) => {
    const existing = await tx.blockRule.findMany({ where: { type }, select: { value: true } });
    if (existing.some((rule) => normalizeForMatch(rule.value) === normalizeForMatch(value))) {
      throw new ModerationConflictError("An equivalent block rule already exists.");
    }
    const rule = await tx.blockRule.create({ data: { type, value }, select: { id: true, type: true, value: true, enabled: true } });
    const affectedCount = await recheckActiveCharacters(tx);
    return { rule, affectedCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setBlockRuleEnabled(
  id: string,
  enabled: unknown,
  client?: PrismaClient,
): Promise<{ affectedCount: number }> {
  if (typeof enabled !== "boolean") throw new ModerationValidationError("enabled must be a boolean.");
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$transaction(async (tx) => {
    const updated = await tx.blockRule.updateMany({ where: { id }, data: { enabled } });
    if (updated.count === 0) throw new ModerationNotFoundError("Block rule not found.");
    return { affectedCount: enabled ? await recheckActiveCharacters(tx) : 0 };
  });
}

export async function deleteBlockRule(id: string, client?: PrismaClient): Promise<void> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const deleted = await database.blockRule.deleteMany({ where: { id } });
  if (deleted.count === 0) throw new ModerationNotFoundError("Block rule not found.");
}

export async function createBlockedCreatorAndRecheck(
  input: { platform?: unknown; externalCreatorId?: unknown; creatorName?: unknown; reason?: unknown },
  client?: PrismaClient,
): Promise<{ affectedCount: number }> {
  const platform = parseOptionalPlatform(input.platform);
  const externalCreatorId = parseOptionalText(input.externalCreatorId);
  const creatorName = parseOptionalText(input.creatorName);
  const reason = parseOptionalText(input.reason);
  if (!externalCreatorId && !creatorName) {
    throw new ModerationValidationError("A creator ID or creator name is required.");
  }

  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$transaction(async (tx) => {
    await tx.blockedCreator.create({ data: { platform, externalCreatorId, creatorName, reason } });
    return { affectedCount: await recheckActiveCharacters(tx) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function setBlockedCreatorEnabled(
  id: string,
  enabled: unknown,
  client?: PrismaClient,
): Promise<{ affectedCount: number }> {
  if (typeof enabled !== "boolean") throw new ModerationValidationError("enabled must be a boolean.");
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  return database.$transaction(async (tx) => {
    const updated = await tx.blockedCreator.updateMany({ where: { id }, data: { enabled } });
    if (updated.count === 0) throw new ModerationNotFoundError("Blocked creator not found.");
    return { affectedCount: enabled ? await recheckActiveCharacters(tx) : 0 };
  });
}

export async function deleteBlockedCreator(id: string, client?: PrismaClient): Promise<void> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const deleted = await database.blockedCreator.deleteMany({ where: { id } });
  if (deleted.count === 0) throw new ModerationNotFoundError("Blocked creator not found.");
}

export async function moderateQuarantinedCharacter(
  id: string,
  action: unknown,
  client?: PrismaClient,
): Promise<void> {
  if (action !== "restore" && action !== "block") {
    throw new ModerationValidationError("Action must be restore or block.");
  }
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const result = await database.character.updateMany({
    where: { id, status: "QUARANTINED" },
    data: action === "restore"
      ? { status: "ACTIVE", blockedReason: null, lastCheckedAt: new Date() }
      : { status: "BLOCKED", lastCheckedAt: new Date() },
  });
  if (result.count === 0) throw new ModerationNotFoundError("Quarantined character not found.");
}

export async function recheckActiveCharacters(client: Prisma.TransactionClient): Promise<number> {
  const [rows, criteria] = await Promise.all([
    client.character.findMany({ where: { status: "ACTIVE" }, select: moderationCharacterSelect }),
    loadModerationCriteria(client),
  ]);
  return recheckCharacterRecords(rows.map(mapCharacterRow), criteria, async (id, matches) => {
    await client.character.updateMany({
      where: { id, status: "ACTIVE" },
      data: {
        status: "QUARANTINED",
        blockedReason: formatBlockedReason(matches),
        lastCheckedAt: new Date(),
      },
    });
  });
}

export async function recheckCharacterRecords(
  characters: ModerationCharacterRecord[],
  criteria: ModerationCriteria,
  quarantine: (id: string, matches: ModerationMatch[]) => Promise<void>,
): Promise<number> {
  let affectedCount = 0;
  for (const character of characters) {
    if (character.status !== "ACTIVE") continue;
    const result = evaluateCharacterBlocklist(character, criteria.rules, criteria.blockedCreators);
    if (!result.blocked) continue;
    await quarantine(character.id, result.matches);
    affectedCount += 1;
  }
  return affectedCount;
}

export function normalizedCharacterToFilterable(character: NormalizedCharacter): FilterableCharacter {
  return {
    name: character.name,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    exampleDialogs: character.exampleDialogs,
    greetings: character.greetings.map((greeting) => greeting.content),
    tags: character.tags.map(({ name, slug }) => ({ name, slug })),
    sources: [{
      platform: character.platform,
      externalCreatorId: character.creator.externalId,
      creatorName: character.creator.name,
    }],
  };
}

async function loadModerationCriteria(client: Prisma.TransactionClient): Promise<ModerationCriteria> {
  const [rules, blockedCreators] = await Promise.all([
    client.blockRule.findMany({ where: { enabled: true }, select: { id: true, type: true, value: true, enabled: true } }),
    client.blockedCreator.findMany({
      where: { enabled: true },
      select: { id: true, platform: true, externalCreatorId: true, creatorName: true, enabled: true },
    }),
  ]);
  return { rules, blockedCreators };
}

function mapCharacterRow(row: ModerationCharacterRow): ModerationCharacterRecord {
  return {
    id: row.id,
    status: row.status,
    name: row.name,
    description: row.description,
    personality: row.personality,
    scenario: row.scenario,
    exampleDialogs: row.exampleDialogs,
    greetings: row.greetings.map((greeting) => greeting.content),
    tags: row.tags.map(({ tag }) => tag),
    sources: row.sources,
  };
}

function parseRuleType(value: unknown): ModerationRuleType {
  if (typeof value !== "string" || !RULE_TYPES.includes(value as ModerationRuleType)) {
    throw new ModerationValidationError("A valid block rule type is required.");
  }
  return value as ModerationRuleType;
}

function parseOptionalPlatform(value: unknown): ModerationPlatform | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !PLATFORMS.includes(value as ModerationPlatform)) {
    throw new ModerationValidationError("A valid source platform is required.");
  }
  return value as ModerationPlatform;
}

function parseRequiredText(value: unknown, label: string): string {
  const parsed = parseOptionalText(value);
  if (!parsed) throw new ModerationValidationError(`${label} is required.`);
  if (parsed.length > 500) throw new ModerationValidationError(`${label} must be 500 characters or fewer.`);
  return parsed;
}

function parseOptionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ModerationValidationError("Text values must be strings.");
  const parsed = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return parsed.length > 0 ? parsed : null;
}
