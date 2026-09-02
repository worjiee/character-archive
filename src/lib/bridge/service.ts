import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type { DuplicateAnalysis } from "../importers/duplicate-detector";
import { normalizeJanitorCharacter } from "../importers/janitor";
import { persistPreparedImportPreviewJob, prepareImportPreviewJob } from "../importers/preview-jobs";
import type { NormalizedCharacter } from "../importers/types";
import type { ImportPreview } from "../importers/workflow";
import type { ModerationResult } from "../moderation/matcher";
import { requireAllowedArchiveOrigin } from "./config";
import { validateJanitorCharacterBridgeEnvelope } from "./envelope";
import { BridgeError } from "./errors";
import {
  isCharacterBridgeTarget,
  resolveBridgePairingRequest,
  sameBridgeTarget,
  storedBridgeTarget,
  validateExtensionBridgeTarget,
  validateStoredBridgeTarget,
  type BridgeTarget,
  type ExtensionBridgeTarget,
} from "./target";

export const BRIDGE_PAIRING_TTL_MS = 5 * 60 * 1000;
export const BRIDGE_SESSION_TTL_MS = 10 * 60 * 1000;
export const BRIDGE_PROFILE_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_PAIR_EXCHANGE_ATTEMPTS = 5;

export interface BridgeServiceOptions {
  client?: PrismaClient;
  now?: () => Date;
  allowedArchiveOrigins?: Set<string>;
  randomBytes?: (size: number) => Buffer;
  analyze?: (character: NormalizedCharacter, client: PrismaClient) => Promise<DuplicateAnalysis>;
  moderate?: (character: NormalizedCharacter, client: PrismaClient) => Promise<ModerationResult>;
}

export interface BridgeExchangeOptions extends BridgeServiceOptions {
  capabilityOrigin?: string;
  presentedTarget?: unknown;
}

export interface BridgeReceiveOptions extends BridgeServiceOptions {
  capabilityOrigin?: string;
}

export interface BridgeJobDto {
  id: string;
  status: "WAITING" | "PAIRED" | "READY" | "SAVED" | "REJECTED" | "CANCELLED" | "EXPIRED";
  expiresAt: string;
  receivedAt: string | null;
  sourceUrl: string | null;
  previewJobId: string | null;
  preview: ImportPreview | null;
  savedCharacterId: string | null;
  profile: unknown | null;
  target: BridgeTarget | null;
}

interface BridgePreviewReceipt { previewJobId: string; preview: ImportPreview }

export async function createBridgePairing(
  userSessionId: string,
  archiveOrigin: string,
  request: unknown,
  options: BridgeServiceOptions = {},
): Promise<{ pairingCode: string; jobId: string; expiresAt: string; target: BridgeTarget }> {
  requireAllowedArchiveOrigin(archiveOrigin, options.allowedArchiveOrigins);
  const target = resolveBridgePairingRequest(request);
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const expiresAt = new Date(now.getTime() + BRIDGE_PAIRING_TTL_MS);
  const pairingCode = formatPairingCode((options.randomBytes ?? randomBytes)(8));
  const record = await database.bridgePairing.create({
    data: {
      codeHash: hashSecret(normalizePairingCode(pairingCode)),
      userSessionId,
      platform: target.platform,
      operation: "CHARACTER_IMPORT",
      archiveOrigin,
      expiresAt,
      job: {
        create: {
          expiresAt,
          sourceUrl: targetUrl(target),
          payload: toJson(storedBridgeTarget(target)),
        },
      },
    },
    select: { job: { select: { id: true } } },
  });
  if (!record.job) throw new BridgeError("PAIRING_FAILED", "The bridge pairing could not be created.", 500);
  return { pairingCode, jobId: record.job.id, expiresAt: expiresAt.toISOString(), target };
}

export async function exchangeBridgePairing(
  pairingCode: string,
  archiveOrigin: string,
  options: BridgeExchangeOptions = {},
): Promise<{ bridgeToken: string; jobId: string; expiresAt: string; target: ExtensionBridgeTarget }> {
  requireAllowedArchiveOrigin(archiveOrigin, options.allowedArchiveOrigins);
  const capabilityOrigin = options.capabilityOrigin ?? archiveOrigin;
  const presentedTarget = options.presentedTarget === undefined ? null : validateExtensionBridgeTarget(options.presentedTarget);
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const normalizedCode = normalizePairingCode(pairingCode);
  if (!/^[0-9A-F]{16}$/.test(normalizedCode)) invalidPairing();
  const codeHash = hashSecret(normalizedCode);
  const bridgeToken = (options.randomBytes ?? randomBytes)(32).toString("base64url");

  try {
    const outcome = await database.$transaction(async (tx) => {
      const pairing = await tx.bridgePairing.findUnique({
        where: { codeHash },
        select: {
          id: true, archiveOrigin: true, platform: true, operation: true, expiresAt: true,
          usedAt: true, cancelledAt: true, exchangeAttempts: true,
          job: { select: { id: true, sourceUrl: true, payload: true } },
        },
      });
      if (!pairing) invalidPairing();
      await tx.bridgePairing.update({ where: { id: pairing.id }, data: { exchangeAttempts: { increment: 1 } } });
      if (pairing.exchangeAttempts >= MAX_PAIR_EXCHANGE_ATTEMPTS) return failure("PAIRING_RATE_LIMITED", "Too many pairing attempts.", 429);
      if (pairing.archiveOrigin !== archiveOrigin) return failure("PAIRING_ORIGIN_MISMATCH", "The pairing belongs to a different Archive origin.", 403);
      if (pairing.cancelledAt || pairing.expiresAt <= now) return failure("PAIRING_EXPIRED", "The bridge pairing expired or was cancelled.", 410);
      if (pairing.usedAt) return failure("PAIRING_ALREADY_USED", "The bridge pairing code was already used.", 409);
      if (pairing.platform !== "JANITOR_AI" || pairing.operation !== "CHARACTER_IMPORT" || !pairing.job?.sourceUrl) invalidPairing();

      const storedTarget = validateStoredBridgeTarget(pairing.job.payload);
      if (targetUrl(storedTarget) !== pairing.job.sourceUrl) invalidPairing();
      if (presentedTarget && !sameBridgeTarget(storedTarget, presentedTarget)) {
        return isCharacterBridgeTarget(storedTarget)
          ? failure("WRONG_CHARACTER", "The pairing belongs to a different character page.", 409)
          : failure("WRONG_PROFILE", "The pairing belongs to a different Janitor profile.", 409);
      }
      const responseTarget: ExtensionBridgeTarget = presentedTarget ?? { ...storedTarget, pageOrigin: "https://janitorai.com" };
      const expiresAt = new Date(now.getTime() + (isCharacterBridgeTarget(storedTarget) ? BRIDGE_SESSION_TTL_MS : BRIDGE_PROFILE_SESSION_TTL_MS));
      const session = await tx.bridgeSession.create({
        data: {
          pairingId: pairing.id,
          tokenHash: hashCapability(capabilityOrigin, bridgeToken),
          platform: storedTarget.platform,
          payloadType: "CHARACTER",
          expiresAt,
        },
        select: { id: true },
      });
      await tx.bridgePairing.update({ where: { id: pairing.id }, data: { usedAt: now } });
      await tx.bridgeJob.update({
        where: { id: pairing.job.id },
        data: { status: "PAIRED", bridgeSessionId: session.id, expiresAt },
      });
      return { result: { bridgeToken, jobId: pairing.job.id, expiresAt: expiresAt.toISOString(), target: responseTarget } };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("error" in outcome) throw new BridgeError(outcome.error.code, outcome.error.message, outcome.error.status);
    return outcome.result;
  } catch (error) {
    if (error instanceof BridgeError) throw error;
    if (isExchangeConflict(error)) throw new BridgeError("PAIRING_ALREADY_USED", "The bridge pairing code was already used.", 409);
    throw error;
  }
}

export async function receiveBridgeCharacter(
  bridgeToken: string,
  envelopeValue: unknown,
  archiveOrigin: string,
  options: BridgeReceiveOptions = {},
): Promise<{ jobId: string; previewJobId: string; preview: ImportPreview }> {
  requireAllowedArchiveOrigin(archiveOrigin, options.allowedArchiveOrigins);
  if (!/^[A-Za-z0-9_-]{43}$/.test(bridgeToken)) invalidBridgeToken();
  const capabilityOrigin = options.capabilityOrigin ?? archiveOrigin;
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const session = await database.bridgeSession.findUnique({
    where: { tokenHash: hashCapability(capabilityOrigin, bridgeToken) },
    select: {
      id: true, platform: true, payloadType: true, expiresAt: true, consumedAt: true, cancelledAt: true,
      pairing: { select: { archiveOrigin: true, cancelledAt: true, userSessionId: true, operation: true } },
      job: { select: { id: true, sourceUrl: true, payload: true } },
    },
  });
  if (!session) invalidBridgeToken();
  if (session.pairing.archiveOrigin !== archiveOrigin) throw new BridgeError("BRIDGE_ORIGIN_MISMATCH", "The bridge session belongs to a different Archive origin.", 403);
  if (session.cancelledAt || session.pairing.cancelledAt || session.expiresAt <= now) throw new BridgeError("CAPABILITY_EXPIRED", "The bridge capability expired or was cancelled.", 410);
  if (session.consumedAt) throw new BridgeError("BRIDGE_REPLAY_REJECTED", "This bridge session already accepted a character.", 409);
  if (session.platform !== "JANITOR_AI" || session.payloadType !== "CHARACTER" || session.pairing.operation !== "CHARACTER_IMPORT" || !session.job?.sourceUrl) invalidBridgeToken();

  const expectedTarget = validateStoredBridgeTarget(session.job.payload);
  if (targetUrl(expectedTarget) !== session.job.sourceUrl) invalidBridgeToken();
  if (!isCharacterBridgeTarget(expectedTarget)) invalidBridgeToken();
  const envelope = validateJanitorCharacterBridgeEnvelope(envelopeValue, expectedTarget);
  const character = normalizeJanitorCharacter(envelope.payload, expectedTarget.canonicalSourceUrl);
  const prepared = await prepareImportPreviewJob(session.pairing.userSessionId, character, "browser-bridge", {
    client: database, now, analyze: options.analyze, moderate: options.moderate,
  });

  const created = await database.$transaction(async (tx) => {
    const claimed = await tx.bridgeSession.updateMany({
      where: { id: session.id, consumedAt: null, cancelledAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) throw new BridgeError("BRIDGE_REPLAY_REJECTED", "This bridge session already accepted a character.", 409);
    const previewJob = await persistPreparedImportPreviewJob(prepared, tx);
    const receipt: BridgePreviewReceipt = { previewJobId: previewJob.previewJobId, preview: previewJob.preview };
    await tx.bridgeJob.update({
      where: { id: session.job!.id },
      data: {
        status: "READY", messageId: envelope.messageId, sourceUrl: expectedTarget.canonicalSourceUrl,
        capturedAt: envelope.capturedAt, receivedAt: now, payload: Prisma.DbNull, preview: toJson(receipt),
      },
    });
    return previewJob;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return { jobId: session.job.id, previewJobId: created.previewJobId, preview: created.preview };
}

export async function getBridgeJob(userSessionId: string, jobId: string, options: BridgeServiceOptions = {}): Promise<BridgeJobDto> {
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  let job = await database.bridgeJob.findFirst({ where: { id: jobId, pairing: { userSessionId } }, select: jobSelect });
  if (!job) throw new BridgeError("BRIDGE_JOB_NOT_FOUND", "Bridge job not found.", 404);
  if (job.expiresAt <= now && ["WAITING", "PAIRED"].includes(job.status)) {
    job = await database.bridgeJob.update({ where: { id: job.id }, data: { status: "EXPIRED" }, select: jobSelect });
  }
  return mapJob(job);
}

export async function cancelBridgeJob(userSessionId: string, jobId: string, options: BridgeServiceOptions = {}): Promise<void> {
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  await database.$transaction(async (tx) => {
    const job = await tx.bridgeJob.findFirst({ where: { id: jobId, pairing: { userSessionId } }, select: { id: true, status: true, pairingId: true, bridgeSessionId: true } });
    if (!job) throw new BridgeError("BRIDGE_JOB_NOT_FOUND", "Bridge job not found.", 404);
    if (job.status === "SAVED") throw new BridgeError("BRIDGE_JOB_ALREADY_SAVED", "A saved bridge job cannot be cancelled.", 409);
    await tx.bridgeJob.update({ where: { id: job.id }, data: { status: "CANCELLED" } });
    await tx.bridgePairing.update({ where: { id: job.pairingId }, data: { cancelledAt: now } });
    if (job.bridgeSessionId) await tx.bridgeSession.update({ where: { id: job.bridgeSessionId }, data: { cancelledAt: now } });
  });
}

const jobSelect = {
  id: true, status: true, expiresAt: true, receivedAt: true, sourceUrl: true,
  payload: true, preview: true, savedCharacterId: true,
} satisfies Prisma.BridgeJobSelect;

function mapJob(job: Prisma.BridgeJobGetPayload<{ select: typeof jobSelect }>): BridgeJobDto {
  const receipt = parseReceipt(job.preview);
  return {
    id: job.id, status: job.status, expiresAt: job.expiresAt.toISOString(),
    receivedAt: job.receivedAt?.toISOString() ?? null, sourceUrl: job.sourceUrl,
    previewJobId: receipt?.previewJobId ?? null, preview: receipt?.preview ?? null,
    savedCharacterId: job.savedCharacterId,
    profile: isRecord(job.preview) && job.preview.kind === "PROFILE_IMPORT" ? job.preview : null,
    target: safeStoredTarget(job.payload),
  };
}

function safeStoredTarget(value: Prisma.JsonValue | null): BridgeTarget | null {
  try { return validateStoredBridgeTarget(value); } catch { return null; }
}

function parseReceipt(value: Prisma.JsonValue | null): BridgePreviewReceipt | null {
  if (!isRecord(value) || typeof value.previewJobId !== "string" || !isRecord(value.preview)) return null;
  return value as unknown as BridgePreviewReceipt;
}
function normalizePairingCode(value: string): string { return value.replace(/[\s-]/g, "").toUpperCase(); }
function hashSecret(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
export function hashCapability(origin: string, token: string): string { return hashSecret(`${origin}\0${token}`); }
function formatPairingCode(value: Buffer): string { return value.toString("hex").toUpperCase().match(/.{1,4}/g)!.join("-"); }
function invalidPairing(): never { throw new BridgeError("INVALID_PAIRING", "The pairing code is invalid.", 401); }
function invalidBridgeToken(): never { throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401); }
function isExchangeConflict(error: unknown): boolean { return isRecord(error) && (error.code === "P2002" || error.code === "P2034"); }
function failure(code: string, message: string, status: number) { return { error: { code, message, status } }; }
function toJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function targetUrl(target: BridgeTarget): string { return isCharacterBridgeTarget(target) ? target.canonicalSourceUrl : target.canonicalProfileUrl; }
