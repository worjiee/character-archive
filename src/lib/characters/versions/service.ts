import type { PrismaClient } from "../../../../generated/prisma/client";
import { visibleCharacterWhere, type AuthenticatedPrincipal } from "../../auth";
import type {
  CanonicalCharacterSnapshot,
  CharacterVersionOrigin,
  CharacterVersionDiffResult,
} from "./types";
import { compareCharacterSnapshots } from "./diff";

export interface CharacterVersionListItem {
  id: string;
  versionNumber: number;
  fingerprint: string;
  origin: CharacterVersionOrigin;
  changeSummary: string | null;
  artworkSha256: string | null;
  tokenCount: number | null;
  permanentTokenCount: number | null;
  createdAt: Date;
  createdBy: {
    displayName: string | null;
    username: string;
  } | null;
}

export interface CharacterHistoricalVersionDetail {
  characterId: string;
  characterName: string;
  currentVersionNumber: number;
  characterStatus: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
  version: {
    id: string;
    versionNumber: number;
    fingerprint: string;
    origin: CharacterVersionOrigin;
    snapshot: CanonicalCharacterSnapshot;
    changeSummary: string | null;
    artworkSha256: string | null;
    tokenCount: number | null;
    permanentTokenCount: number | null;
    createdAt: Date;
    createdBy: {
      displayName: string | null;
      username: string;
    } | null;
  };
}

export interface CharacterVersionComparisonData {
  character: {
    id: string;
    name: string;
    currentVersionNumber: number;
    status: "ACTIVE" | "QUARANTINED" | "BLOCKED" | "DELETED";
  };
  fromVersion: {
    versionNumber: number;
    origin: CharacterVersionOrigin;
    createdAt: Date;
    createdBy: { displayName: string | null; username: string } | null;
    snapshot: CanonicalCharacterSnapshot;
  };
  toVersion: {
    versionNumber: number;
    origin: CharacterVersionOrigin;
    createdAt: Date;
    createdBy: { displayName: string | null; username: string } | null;
    snapshot: CanonicalCharacterSnapshot;
  };
  allVersions: Array<{
    versionNumber: number;
    origin: CharacterVersionOrigin;
    createdAt: Date;
  }>;
  diff: CharacterVersionDiffResult;
}

export async function getCharacterVersionHistory(
  characterId: string,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterVersionListItem[] | null> {
  const database = client ?? (await import("../../../../lib/prisma")).prisma;
  const character = await database.character.findFirst({
    where: { AND: [{ id: characterId }, visibleCharacterWhere(principal)] },
    select: { id: true },
  });
  if (!character) return null;

  const versions = await database.characterVersion.findMany({
    where: { characterId },
    orderBy: { versionNumber: "desc" },
    select: {
      id: true,
      versionNumber: true,
      fingerprint: true,
      origin: true,
      changeSummary: true,
      artworkSha256: true,
      tokenCount: true,
      permanentTokenCount: true,
      createdAt: true,
      createdBy: {
        select: { displayName: true, username: true },
      },
    },
  });

  return versions;
}

export async function getCharacterHistoricalVersion(
  characterId: string,
  versionNumber: number,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterHistoricalVersionDetail | null> {
  const database = client ?? (await import("../../../../lib/prisma")).prisma;
  const character = await database.character.findFirst({
    where: { AND: [{ id: characterId }, visibleCharacterWhere(principal)] },
    select: { id: true, name: true, currentVersionNumber: true, status: true },
  });
  if (!character) return null;

  const version = await database.characterVersion.findUnique({
    where: {
      characterId_versionNumber: {
        characterId,
        versionNumber,
      },
    },
    include: {
      createdBy: {
        select: { displayName: true, username: true },
      },
    },
  });

  if (!version) return null;

  return {
    characterId,
    characterName: character.name,
    currentVersionNumber: character.currentVersionNumber,
    characterStatus: character.status,
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
      fingerprint: version.fingerprint,
      origin: version.origin,
      snapshot: version.snapshot as unknown as CanonicalCharacterSnapshot,
      changeSummary: version.changeSummary,
      artworkSha256: version.artworkSha256,
      tokenCount: version.tokenCount,
      permanentTokenCount: version.permanentTokenCount,
      createdAt: version.createdAt,
      createdBy: version.createdBy,
    },
  };
}

export async function getCharacterVersionComparison(
  characterId: string,
  fromVersionNumber: number,
  toVersionNumber: number,
  principal: AuthenticatedPrincipal,
  client?: PrismaClient,
): Promise<CharacterVersionComparisonData | null> {
  const database = client ?? (await import("../../../../lib/prisma")).prisma;
  const character = await database.character.findFirst({
    where: { AND: [{ id: characterId }, visibleCharacterWhere(principal)] },
    select: { id: true, name: true, currentVersionNumber: true, status: true },
  });
  if (!character) return null;

  const [fromVersion, toVersion, allVersions] = await Promise.all([
    database.characterVersion.findUnique({
      where: { characterId_versionNumber: { characterId, versionNumber: fromVersionNumber } },
      include: { createdBy: { select: { displayName: true, username: true } } },
    }),
    database.characterVersion.findUnique({
      where: { characterId_versionNumber: { characterId, versionNumber: toVersionNumber } },
      include: { createdBy: { select: { displayName: true, username: true } } },
    }),
    database.characterVersion.findMany({
      where: { characterId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true, createdAt: true, origin: true },
    }),
  ]);

  if (!fromVersion || !toVersion) return null;

  const diff = compareCharacterSnapshots(
    fromVersion.snapshot as unknown as CanonicalCharacterSnapshot,
    toVersion.snapshot as unknown as CanonicalCharacterSnapshot,
  );

  return {
    character,
    fromVersion: {
      versionNumber: fromVersion.versionNumber,
      origin: fromVersion.origin,
      createdAt: fromVersion.createdAt,
      createdBy: fromVersion.createdBy,
      snapshot: fromVersion.snapshot as unknown as CanonicalCharacterSnapshot,
    },
    toVersion: {
      versionNumber: toVersion.versionNumber,
      origin: toVersion.origin,
      createdAt: toVersion.createdAt,
      createdBy: toVersion.createdBy,
      snapshot: toVersion.snapshot as unknown as CanonicalCharacterSnapshot,
    },
    allVersions,
    diff,
  };
}
