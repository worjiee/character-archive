import { Prisma } from "../../../generated/prisma/client";
import { normalizeJanitorCharacter } from "../importers/janitor";
import { prepareImportPreviewJob, persistPreparedImportPreviewJob } from "../importers/preview-jobs";
import { requireAllowedArchiveOrigin } from "./config";
import { validateJanitorCharacterBridgeEnvelope } from "./envelope";
import { BridgeError } from "./errors";
import { hashCapability, type BridgeServiceOptions } from "./service";
import { isProfileBridgeTarget, validateStoredBridgeTarget } from "./target";

export const PROFILE_DISCOVERY_MAX = 100;
export const JANITOR_DETAIL_CONCURRENCY = 2;
export const BRIDGE_BATCH_MAX = 10;
const JANITOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROFILE_FAILURE_CODES = new Set(["AUTH_REQUIRED", "NOT_FOUND", "RATE_LIMITED", "INVALID_PAYLOAD", "FAILED", "CANCELLED"]);

export type ProfileItemStatus = "DISCOVERED" | "SELECTED" | "QUEUED" | "RETRIEVING" | "PREVIEW_READY" | "AUTH_REQUIRED" | "NOT_FOUND" | "RATE_LIMITED" | "INVALID_PAYLOAD" | "FAILED" | "CANCELLED" | "PREVIEW_EXPIRED" | "SAVED";
export interface ProfileDiscoveryItem { externalId: string; name: string; avatarUrl: string | null; creatorName: string | null; createdAt: string | null; updatedAt: string | null; }
export interface ProfileCoordinatorItem extends ProfileDiscoveryItem { status: ProfileItemStatus; previewJobId: string | null; previewExpiresAt: string | null; duplicateClassification: string | null; moderationBlocked: boolean | null; errorCode: string | null; savedCharacterId: string | null; }
export interface ProfileCoordinator {
  kind: "PROFILE_IMPORT"; version: 1; phase: "DISCOVERING" | "DISCOVERED" | "RETRIEVING" | "REVIEW" | "CANCELLED";
  profileId: string; canonicalProfileUrl: string; truncated: boolean; reportedTotal: number | null;
  selectedIds: string[]; items: ProfileCoordinatorItem[];
}

export async function receiveProfileDiscovery(token: string, value: unknown, archiveOrigin: string, options: BridgeServiceOptions & { capabilityOrigin?: string } = {}) {
  requireAllowedArchiveOrigin(archiveOrigin, options.allowedArchiveOrigins);
  const { database, target, job } = await profileSession(token, archiveOrigin, options);
  const discovery = validateDiscovery(value, target.profileId);
  const coordinator: ProfileCoordinator = {
    kind: "PROFILE_IMPORT", version: 1, phase: "DISCOVERED", profileId: target.profileId,
    canonicalProfileUrl: target.canonicalProfileUrl, truncated: discovery.truncated,
    reportedTotal: discovery.reportedTotal, selectedIds: [],
    items: discovery.items.map((item) => ({ ...item, status: "DISCOVERED", previewJobId: null, previewExpiresAt: null, duplicateClassification: null, moderationBlocked: null, errorCode: null, savedCharacterId: null })),
  };
  await database.bridgeJob.update({ where: { id: job.id }, data: { status: "PAIRED", preview: toJson(coordinator) } });
  return { jobId: job.id, discovered: coordinator.items.length, truncated: coordinator.truncated };
}

export async function selectProfileCharacters(userSessionId: string, jobId: string, value: unknown, options: BridgeServiceOptions = {}) {
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const job = await database.bridgeJob.findFirst({ where: { id: jobId, pairing: { userSessionId } }, select: { id: true, status: true, expiresAt: true, preview: true } });
  if (!job) throw new BridgeError("BRIDGE_JOB_NOT_FOUND", "Profile operation not found.", 404);
  const coordinator = parseCoordinator(job.preview);
  if (job.status !== "PAIRED" || job.expiresAt <= now || coordinator.phase !== "DISCOVERED") throw new BridgeError("CAPABILITY_EXPIRED", "The profile selection is no longer editable.", 410);
  const ids = validateSelectedIds(value, new Set(coordinator.items.map((item) => item.externalId)));
  const selected = new Set(ids);
  coordinator.selectedIds = ids;
  coordinator.items = coordinator.items.map((item) => ({ ...item, status: selected.has(item.externalId) ? "SELECTED" : item.previewJobId ? item.status : "DISCOVERED" }));
  await database.bridgeJob.update({ where: { id: job.id }, data: { preview: toJson(coordinator) } });
  return coordinator;
}

export async function getProfileSelection(token: string, archiveOrigin: string, options: BridgeServiceOptions & { capabilityOrigin?: string } = {}) {
  const { database, job } = await profileSession(token, archiveOrigin, options);
  const coordinator = parseCoordinator(job.preview);
  if (!["DISCOVERED", "RETRIEVING"].includes(coordinator.phase) || coordinator.selectedIds.length === 0) invalid("INVALID_PROFILE_SELECTION");
  if (coordinator.phase === "DISCOVERED") {
    const selected = new Set(coordinator.selectedIds);
    coordinator.phase = "RETRIEVING";
    coordinator.items = coordinator.items.map((item) => selected.has(item.externalId) ? { ...item, status: "QUEUED" } : item);
    await database.bridgeJob.update({ where: { id: job.id }, data: { status: "PAIRED", preview: toJson(coordinator) } });
  }
  return { jobId: job.id, selectedIds: coordinator.selectedIds };
}

export async function receiveProfileCharacterBatch(token: string, value: unknown, archiveOrigin: string, options: BridgeServiceOptions & { capabilityOrigin?: string } = {}) {
  const { database, session, job } = await profileSession(token, archiveOrigin, options);
  const coordinator = parseCoordinator(job.preview);
  const envelopes = validateBatch(value);
  const selected = new Set(coordinator.selectedIds);
  const discovered = new Set(coordinator.items.map((item) => item.externalId));
  const results: Array<{ externalId: string; status: string; previewJobId?: string; errorCode?: string }> = [];
  coordinator.phase = "RETRIEVING";
  for (const envelopeValue of envelopes) {
    const externalId = envelopeExternalId(envelopeValue);
    if (!externalId || !selected.has(externalId) || !discovered.has(externalId)) {
      results.push({ externalId: externalId ?? "invalid", status: "FAILED", errorCode: "UNDISCOVERED_CHARACTER" });
      continue;
    }
    const item = coordinator.items.find((candidate) => candidate.externalId === externalId)!;
    if (item.status === "PREVIEW_READY" && item.previewJobId) {
      results.push({ externalId, status: "PREVIEW_READY", previewJobId: item.previewJobId });
      continue;
    }
    try {
      const expected = { targetKind: "CHARACTER" as const, platform: "JANITOR_AI" as const, externalId, canonicalSourceUrl: `https://janitorai.com/characters/${externalId}` };
      const envelope = validateJanitorCharacterBridgeEnvelope(envelopeValue, expected);
      const character = normalizeJanitorCharacter(envelope.payload, expected.canonicalSourceUrl);
      const prepared = await prepareImportPreviewJob(session.pairing.userSessionId, character, "browser-bridge", { client: database, now: options.now?.() ?? new Date(), analyze: options.analyze, moderate: options.moderate });
      const created = await persistPreparedImportPreviewJob(prepared, database);
      item.status = "PREVIEW_READY"; item.previewJobId = created.previewJobId; item.previewExpiresAt = created.expiresAt;
      item.duplicateClassification = created.preview.duplicateAnalysis?.classification ?? null;
      item.moderationBlocked = created.preview.moderation?.blocked ?? null; item.errorCode = null;
      results.push({ externalId, status: "PREVIEW_READY", previewJobId: created.previewJobId });
    } catch (error) {
      item.status = "INVALID_PAYLOAD"; item.errorCode = error instanceof BridgeError ? error.code : "INVALID_SOURCE_PAYLOAD";
      results.push({ externalId, status: item.status, errorCode: item.errorCode });
    }
  }
  coordinator.phase = coordinator.selectedIds.every((id) => coordinator.items.find((item) => item.externalId === id)?.status === "PREVIEW_READY") ? "REVIEW" : "RETRIEVING";
  await database.bridgeJob.update({ where: { id: job.id }, data: { status: coordinator.phase === "REVIEW" ? "READY" : "PAIRED", preview: toJson(coordinator) } });
  return { jobId: job.id, results };
}

export async function recordProfileItemFailure(token: string, value: unknown, archiveOrigin: string, options: BridgeServiceOptions & { capabilityOrigin?: string } = {}) {
  const { database, job } = await profileSession(token, archiveOrigin, options);
  const coordinator = parseCoordinator(job.preview);
  if (!isRecord(value) || typeof value.externalId !== "string" || typeof value.status !== "string" || !PROFILE_FAILURE_CODES.has(value.status)) invalid("INVALID_PROFILE_STATUS");
  const externalId = value.externalId as string;
  const status = value.status as string;
  const item = coordinator.items.find((candidate) => candidate.externalId === externalId.toLowerCase());
  if (!item || !coordinator.selectedIds.includes(item.externalId)) invalid("UNDISCOVERED_CHARACTER");
  if (item.status !== "PREVIEW_READY") {
    item.status = status as Extract<ProfileItemStatus, "AUTH_REQUIRED" | "NOT_FOUND" | "RATE_LIMITED" | "INVALID_PAYLOAD" | "FAILED" | "CANCELLED">;
    item.errorCode = typeof value.errorCode === "string" && /^[A-Z0-9_]{2,64}$/u.test(value.errorCode) ? value.errorCode : status;
  }
  coordinator.phase = "RETRIEVING";
  await database.bridgeJob.update({ where: { id: job.id }, data: { status: "PAIRED", preview: toJson(coordinator) } });
  return { jobId: job.id, externalId: item.externalId, status: item.status };
}

export async function completeProfileTransfer(token: string, value: unknown, archiveOrigin: string, options: BridgeServiceOptions & { capabilityOrigin?: string } = {}) {
  const { database, session, job } = await profileSession(token, archiveOrigin, options);
  const coordinator = parseCoordinator(job.preview);
  if (!isRecord(value) || !["COMPLETE", "CANCELLED"].includes(String(value.status))) invalid("INVALID_PROFILE_STATUS");
  const cancelled = value.status === "CANCELLED";
  const selected = new Set(coordinator.selectedIds);
  coordinator.items = coordinator.items.map((item) => selected.has(item.externalId) && ["SELECTED", "QUEUED", "RETRIEVING"].includes(item.status)
    ? { ...item, status: cancelled ? "CANCELLED" : "FAILED", errorCode: cancelled ? "CANCELLED" : "RETRIEVAL_FAILED" }
    : item);
  coordinator.phase = cancelled ? "CANCELLED" : "REVIEW";
  const now = options.now?.() ?? new Date();
  await database.$transaction(async (tx) => {
    await tx.bridgeJob.update({ where: { id: job.id }, data: { status: cancelled ? "CANCELLED" : "READY", receivedAt: now, preview: toJson(coordinator) } });
    await tx.bridgeSession.updateMany({ where: { id: session.id, consumedAt: null }, data: { consumedAt: now } });
  });
  return { jobId: job.id, phase: coordinator.phase };
}

export async function cancelProfileOperation(userSessionId: string, jobId: string, options: BridgeServiceOptions = {}) {
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const job = await database.bridgeJob.findFirst({ where: { id: jobId, pairing: { userSessionId } }, select: { id: true, preview: true } });
  if (!job) throw new BridgeError("BRIDGE_JOB_NOT_FOUND", "Profile operation not found.", 404);
  const coordinator = parseCoordinator(job.preview); coordinator.phase = "CANCELLED";
  coordinator.items = coordinator.items.map((item) => item.status === "PREVIEW_READY" ? item : { ...item, status: "CANCELLED" });
  await database.bridgeJob.update({ where: { id: job.id }, data: { status: "CANCELLED", preview: toJson(coordinator) } });
}

async function profileSession(token: string, archiveOrigin: string, options: BridgeServiceOptions & { capabilityOrigin?: string }) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
  const database = options.client ?? (await import("../../../lib/prisma")).prisma;
  const now = options.now?.() ?? new Date();
  const session = await database.bridgeSession.findUnique({ where: { tokenHash: hashCapability(options.capabilityOrigin ?? archiveOrigin, token) }, select: { id: true, expiresAt: true, consumedAt: true, cancelledAt: true, pairing: { select: { archiveOrigin: true, cancelledAt: true, userSessionId: true } }, job: { select: { id: true, sourceUrl: true, payload: true, preview: true } } } });
  if (!session || !session.job?.sourceUrl || session.pairing.archiveOrigin !== archiveOrigin) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
  if (session.cancelledAt || session.pairing.cancelledAt || session.expiresAt <= now || session.consumedAt) throw new BridgeError("CAPABILITY_EXPIRED", "The profile capability expired or was cancelled.", 410);
  const job = session.job;
  const sourceUrl = job.sourceUrl;
  if (!sourceUrl) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
  const target = validateStoredBridgeTarget(job.payload);
  if (!isProfileBridgeTarget(target)) throw new BridgeError("WRONG_PROFILE", "The capability is not bound to a profile.", 409);
  if (sourceUrl !== target.canonicalProfileUrl) throw new BridgeError("INVALID_BRIDGE_TOKEN", "The bridge session is invalid.", 401);
  return { database, session, target, job };
}

function validateDiscovery(value: unknown, profileId: string): { items: ProfileDiscoveryItem[]; truncated: boolean; reportedTotal: number | null } {
  if (!isRecord(value) || value.profileId !== profileId || typeof value.truncated !== "boolean" || !(value.reportedTotal === null || Number.isSafeInteger(value.reportedTotal)) || !Array.isArray(value.items) || value.items.length > PROFILE_DISCOVERY_MAX) invalid("INVALID_PROFILE_DISCOVERY");
  const seen = new Set<string>(); const items: ProfileDiscoveryItem[] = [];
  for (const raw of value.items) {
    if (!isRecord(raw) || typeof raw.externalId !== "string" || !JANITOR_UUID.test(raw.externalId) || typeof raw.name !== "string" || !raw.name.trim()) continue;
    const externalId = raw.externalId.toLowerCase(); if (seen.has(externalId)) continue; seen.add(externalId);
    items.push({ externalId, name: raw.name.trim().slice(0, 200), avatarUrl: nullableString(raw.avatarUrl), creatorName: nullableString(raw.creatorName), createdAt: nullableDate(raw.createdAt), updatedAt: nullableDate(raw.updatedAt) });
  }
  return { items, truncated: value.truncated, reportedTotal: value.reportedTotal as number | null };
}
function validateSelectedIds(value: unknown, allowed: Set<string>): string[] { if (!isRecord(value) || !Array.isArray(value.selectedIds) || value.selectedIds.length > PROFILE_DISCOVERY_MAX) invalid("INVALID_PROFILE_SELECTION"); const ids = [...new Set(value.selectedIds)]; if (ids.some((id) => typeof id !== "string" || !allowed.has(id))) invalid("UNDISCOVERED_CHARACTER"); return ids as string[]; }
function validateBatch(value: unknown): unknown[] { if (!isRecord(value) || !Array.isArray(value.envelopes) || value.envelopes.length < 1 || value.envelopes.length > BRIDGE_BATCH_MAX) invalid("INVALID_PROFILE_BATCH"); return value.envelopes; }
function envelopeExternalId(value: unknown): string | null { return isRecord(value) && isRecord(value.payload) && typeof value.payload.id === "string" ? value.payload.id.toLowerCase() : null; }
function parseCoordinator(value: Prisma.JsonValue | null): ProfileCoordinator { if (!isRecord(value) || value.kind !== "PROFILE_IMPORT" || value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.selectedIds)) invalid("PROFILE_DISCOVERY_REQUIRED"); return value as unknown as ProfileCoordinator; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim().slice(0, 2048) : null; }
function nullableDate(value: unknown): string | null { if (typeof value !== "string" || !Number.isFinite(new Date(value).getTime())) return null; return new Date(value).toISOString(); }
function invalid(code: string): never { throw new BridgeError(code, "The profile operation request is invalid.", 422); }
function toJson(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

export function profileCoordinatorPreview(value: Prisma.JsonValue | null): ProfileCoordinator | null { try { return parseCoordinator(value); } catch { return null; } }
