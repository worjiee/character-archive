import type { Prisma, PrismaClient } from "../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../auth";

export const CHARACTER_EXPORT_SCHEMA = "character-archive.normalized-character";
export const CHARACTER_EXPORT_VERSION = 1;
export const CHARACTER_EXPORT_FILENAME_STEM_LIMIT = 80;

export const CHARACTER_EXPORT_SELECT = {
  name: true,
  nameOverride: true,
  description: true,
  descriptionOverride: true,
  personality: true,
  personalityOverride: true,
  scenario: true,
  scenarioOverride: true,
  exampleDialogs: true,
  avatarUrl: true,
  avatarUrlOverride: true,
  createdAt: true,
  updatedAt: true,
  sources: {
    orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
    select: {
      platform: true,
      externalId: true,
      externalCreatorId: true,
      creatorName: true,
      sourceUrl: true,
      sourceCreatedAt: true,
      sourceUpdatedAt: true,
    },
  },
  greetings: {
    where: { hidden: false },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: {
      id: true,
      externalId: true,
      content: true,
      position: true,
      localPosition: true,
      characterSource: {
        select: { platform: true, externalId: true },
      },
    },
  },
  tags: {
    orderBy: { tag: { name: "asc" } },
    select: { tag: { select: { name: true, slug: true } } },
  },
  lorebooks: {
    orderBy: { lorebook: { title: "asc" } },
    select: {
      lorebook: {
        select: {
          title: true,
          externalId: true,
          sourcePlatform: true,
          sourceUrl: true,
        },
      },
    },
  },
} satisfies Prisma.CharacterSelect;

type CharacterExportRecord = Prisma.CharacterGetPayload<{ select: typeof CHARACTER_EXPORT_SELECT }>;

export interface CharacterExportDto {
  schema: typeof CHARACTER_EXPORT_SCHEMA;
  version: typeof CHARACTER_EXPORT_VERSION;
  character: {
    name: string;
    description: string | null;
    personality: string | null;
    scenario: string | null;
    exampleDialogs: string | null;
    avatarUrl: string | null;
    archiveCreatedAt: string;
    archiveUpdatedAt: string;
    sources: Array<{
      platform: string;
      externalId: string;
      externalCreatorId: string | null;
      creatorName: string | null;
      sourceUrl: string;
      sourceCreatedAt: string | null;
      sourceUpdatedAt: string | null;
    }>;
    greetings: Array<{
      position: number;
      content: string;
      sourceGreetingId: string | null;
      source: { platform: string; externalId: string };
    }>;
    tags: Array<{ name: string; slug: string }>;
    lorebooks: Array<{
      title: string;
      externalId: string;
      sourcePlatform: string;
      sourceUrl: string;
    }>;
  };
}

export async function getCharacterExport(
  id: string,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterExportDto | null> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const record = await database.character.findFirst({
    where: { AND: [{ id }, visibleCharacterWhere(principal)] },
    select: CHARACTER_EXPORT_SELECT,
  });
  return record ? toCharacterExportDto(record) : null;
}

export function toCharacterExportDto(record: CharacterExportRecord): CharacterExportDto {
  const greetings = [...record.greetings].sort((left, right) =>
    (left.localPosition ?? left.position) - (right.localPosition ?? right.position)
      || left.id.localeCompare(right.id));

  return {
    schema: CHARACTER_EXPORT_SCHEMA,
    version: CHARACTER_EXPORT_VERSION,
    character: {
      name: record.nameOverride ?? record.name,
      description: record.descriptionOverride ?? record.description,
      personality: record.personalityOverride ?? record.personality,
      scenario: record.scenarioOverride ?? record.scenario,
      exampleDialogs: record.exampleDialogs,
      avatarUrl: record.avatarUrlOverride ?? record.avatarUrl,
      archiveCreatedAt: record.createdAt.toISOString(),
      archiveUpdatedAt: record.updatedAt.toISOString(),
      sources: record.sources.map((source) => ({
        platform: source.platform,
        externalId: source.externalId,
        externalCreatorId: source.externalCreatorId,
        creatorName: source.creatorName,
        sourceUrl: source.sourceUrl,
        sourceCreatedAt: source.sourceCreatedAt?.toISOString() ?? null,
        sourceUpdatedAt: source.sourceUpdatedAt?.toISOString() ?? null,
      })),
      greetings: greetings.map((greeting, position) => ({
        position,
        content: greeting.content,
        sourceGreetingId: greeting.externalId,
        source: greeting.characterSource,
      })),
      tags: record.tags.map(({ tag }) => tag),
      lorebooks: record.lorebooks.map(({ lorebook }) => lorebook),
    },
  };
}

export function characterExportFilename(name: string): string {
  const stem = name
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, CHARACTER_EXPORT_FILENAME_STEM_LIMIT)
    .replace(/-+$/g, "");
  const safeStem = stem && !isReservedFilenameStem(stem) ? stem : stem ? `character-${stem}` : "character-export";
  return `${safeStem}.json`;
}

function isReservedFilenameStem(stem: string): boolean {
  return /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i.test(stem);
}
