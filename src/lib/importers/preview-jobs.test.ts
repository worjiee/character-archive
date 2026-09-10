import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtworkObjectStore, PendingArtworkBinding } from "../artwork";
import type { NormalizedCharacter } from "./types";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  moderate: vi.fn(),
  persist: vi.fn(),
  notifySession: vi.fn(),
  notifyAdmins: vi.fn(),
}));
vi.mock("../notifications", () => ({
  createNotificationForSession: mocks.notifySession,
  createAdminNotifications: mocks.notifyAdmins,
}));

vi.mock("./duplicate-detector", () => ({
  analyzeDuplicates: mocks.analyze,
}));
vi.mock("../moderation/service", () => ({
  previewNormalizedCharacterModeration: mocks.moderate,
}));
vi.mock("./persistence/persist-normalized-character", () => ({
  CHARACTER_IMPORT_TRANSACTION_MAX_WAIT_MS: 5_000,
  CHARACTER_IMPORT_TRANSACTION_TIMEOUT_MS: 15_000,
  persistNormalizedCharacter: vi.fn(),
  persistNormalizedCharacterInTransaction: mocks.persist,
}));

import {
  cleanupImportPreviewJobs,
  createImportPreviewJob,
  getImportPreviewJob,
  ImportPreviewJobError,
  persistPreparedImportPreviewJobs,
  prepareImportPreviewJob,
  saveImportPreviewJob,
} from "./preview-jobs";

const NOW = new Date("2026-08-29T08:00:00.000Z");
const JOB_ID = "cm1234567890abcdef123456";
const PRINCIPAL = { userId: "user-a", username: "a", displayName: "A", role: "MEMBER" as const };

describe("immutable import preview jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.analyze.mockResolvedValue({ classification: "NO_MATCH", candidates: [] });
    mocks.moderate.mockResolvedValue({ blocked: false, matches: [] });
    mocks.persist.mockResolvedValue({
      characterId: "character-a",
      characterSourceId: "source-a",
      moderation: { blocked: false, matches: [] },
      status: "ACTIVE",
      blockedReason: null,
    });
  });

  it("creates a session-owned opaque 15-minute job with a sanitized snapshot", async () => {
    const database = fakeDatabase();
    const created = await createImportPreviewJob("session-a", character("Reviewed A"), "automatic-url", {
      client: database.client,
      now: NOW,
    });

    expect(created.previewJobId).toBe(JOB_ID);
    expect(created.expiresAt).toBe("2026-08-29T08:15:00.000Z");
    expect(created.preview.name).toBe("Reviewed A");
    expect(database.row?.userSessionId).toBe("session-a");
    expect(JSON.stringify(database.row?.snapshot)).not.toContain("upstream-secret-field");
    expect(created.preview).not.toHaveProperty("rawData");
  });

  it("persists a prepared artifact batch atomically without an interactive transaction", async () => {
    const analysisDatabase = fakeDatabase();
    const first = await prepareImportPreviewJob("session-a", character("Artifact A"), "artifact-upload", {
      client: analysisDatabase.client,
      now: NOW,
    });
    const second = await prepareImportPreviewJob("session-a", character("Artifact B"), "artifact-upload", {
      client: analysisDatabase.client,
      now: NOW,
    });
    const createMany = vi.fn(async ({ data }: { data: Array<{ id: string }> }) => ({ count: data.length }));

    const created = await persistPreparedImportPreviewJobs(
      [first, second],
      { importPreviewJob: { createMany } } as never,
    );

    expect(createMany).toHaveBeenCalledTimes(1);
    const records = createMany.mock.calls[0][0].data;
    expect(records).toHaveLength(2);
    expect(records[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(records[1].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(records[0].id).not.toBe(records[1].id);
    expect(created.map((job) => job.previewJobId)).toEqual(records.map((record) => record.id));
    expect(created.map((job) => job.preview.name)).toEqual(["Artifact A", "Artifact B"]);
  });

  it("consumes once and persists the exact reviewed snapshot without retrieval", async () => {
    const database = fakeDatabase();
    await createImportPreviewJob("session-a", character("Reviewed A"), "automatic-url", { client: database.client, now: NOW });

    await saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, { client: database.client, now: NOW });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Reviewed A" }),
      expect.objectContaining({ principal: PRINCIPAL }),
    );
    expect(database.row?.consumedAt).toEqual(NOW);
    expect(database.row?.savedCharacterId).toBe("character-a");

    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: database.client,
      now: new Date(NOW.getTime() + 1_000),
    })).rejects.toMatchObject({ code: "PREVIEW_CONSUMED", savedCharacterId: "character-a" });
    expect(mocks.persist).toHaveBeenCalledTimes(1);
  });

  it("recovers savedCharacterId when concurrent updateMany fails to claim the job", async () => {
    const database = fakeDatabase();
    await createImportPreviewJob("session-a", character("Concurrent Job"), "automatic-url", { client: database.client, now: NOW });
    // Simulate concurrent winner having consumed the job and set savedCharacterId
    database.row!.consumedAt = NOW;
    database.row!.savedCharacterId = "winner-character-123";

    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: database.client,
      now: NOW,
    })).rejects.toMatchObject({
      code: "PREVIEW_CONSUMED",
      savedCharacterId: "winner-character-123",
    });
  });

  it("compensates by deleting unreferenced final artwork and emits IMPORT_FAILED notification on failure", async () => {
    const database = fakeDatabase();
    const { store, binding } = artworkStore();
    await createImportPreviewJob("session-a", character("Failing Job"), "artifact-upload", {
      client: database.client,
      now: NOW,
      artwork: binding,
    });
    mocks.persist.mockRejectedValueOnce(new Error("Database write failed"));

    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: database.client,
      artworkStore: store,
      now: NOW,
    })).rejects.toThrow("Database write failed");

    expect(store.deleteFinal).toHaveBeenCalledWith(`artwork/sha256/${binding.sha256}.png`);
    expect(mocks.notifySession).toHaveBeenCalledWith(
      "session-a",
      expect.objectContaining({
        category: "IMPORT_FAILED",
        title: "Character save failed",
        entityId: JOB_ID,
      }),
      database.client,
    );
  });

  it("saves a Companion preview after its transport payload is cleared", async () => {
    const database = fakeDatabase();
    const received = character("Reviewed Companion Snapshot");
    await createImportPreviewJob("session-a", received, "browser-bridge", { client: database.client, now: NOW });

    received.name = "Mutated after preview";
    received.rawData = {};
    await saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, { client: database.client, now: NOW });

    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Reviewed Companion Snapshot" }),
      expect.objectContaining({ principal: PRINCIPAL }),
    );
  });

  it("links new moderation notifications to the canonical quarantine route", async () => {
    const database = fakeDatabase();
    mocks.persist.mockResolvedValueOnce({
      characterId: "quarantined-character",
      characterSourceId: "source-a",
      moderation: { blocked: true, matches: [] },
      status: "QUARANTINED",
      blockedReason: "Matched a rule.",
    });
    await createImportPreviewJob("session-a", character("Quarantined import"), "browser-bridge", { client: database.client, now: NOW });
    await saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, { client: database.client, now: NOW });

    expect(mocks.notifyAdmins).toHaveBeenCalledWith(
      expect.objectContaining({ href: "/blocked/quarantine", entityId: "quarantined-character" }),
      expect.anything(),
    );
  });

  it("stores artifact lorebooks inside the exact session-owned preview snapshot", async () => {
    const database = fakeDatabase();
    const received = character("Artifact card");
    received.embeddedLorebooks = [{
      externalId: "lore-1",
      platform: "JANITOR_AI",
      title: "World",
      description: null,
      sourceUrl: `${received.sourceUrl}#lorebook-lore-1`,
      entries: [{
        externalEntryId: "entry-1", content: "Reviewed entry", keys: ["world"], category: null,
        enabled: true, constant: false, insertionOrder: 0, comment: null, caseSensitive: null,
        activationMode: null, activationScript: null, groupWeight: null, rawData: { secret: "discarded only at character root" },
      }],
      rawData: { contract: "reviewed" },
    }];
    await createImportPreviewJob("session-a", received, "artifact-upload", { client: database.client, now: NOW });
    received.embeddedLorebooks[0].entries[0].content = "Mutated after preview";
    await saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, { client: database.client, now: NOW });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ embeddedLorebooks: [expect.objectContaining({ entries: [expect.objectContaining({ content: "Reviewed entry" })] })] }),
      expect.anything(),
    );
  });

  it("keeps uploaded artwork pending through Preview and promotes the exact reviewed digest only on Save", async () => {
    const database = fakeDatabase();
    const { binding, bytes, store } = artworkStore();
    const created = await createImportPreviewJob("session-a", character("Artwork card"), "artifact-upload", {
      client: database.client,
      now: NOW,
      artwork: binding,
    });

    expect(created.preview.artwork).toMatchObject({
      url: `/api/import/previews/${JOB_ID}/artwork`,
      sha256: binding.sha256,
      byteLength: bytes.byteLength,
    });
    expect(database.artworkUpserts).toHaveLength(0);

    await saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: database.client,
      now: NOW,
      artworkStore: store,
    });

    expect(store.readPending).toHaveBeenCalledWith(binding);
    expect(store.promotePending).toHaveBeenCalledWith(binding);
    expect(database.artworkUpserts).toHaveLength(1);
    expect(database.artworkUpserts[0]).toMatchObject({ create: { sha256: binding.sha256, storageKey: `artwork/sha256/${binding.sha256}.png` } });
    expect(mocks.persist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "Artwork card" }),
      expect.objectContaining({ artworkSha256: binding.sha256 }),
    );
    expect(store.deletePending).toHaveBeenCalledWith(binding.pendingKey);
  });

  it("does not enter the database transaction when prepared artwork is missing or changed", async () => {
    const missingDatabase = fakeDatabase();
    const missing = artworkStore();
    missing.store.readPending = vi.fn(async () => null);
    await createImportPreviewJob("session-a", character("Missing artwork"), "artifact-upload", {
      client: missingDatabase.client, now: NOW, artwork: missing.binding,
    });
    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: missingDatabase.client, now: NOW, artworkStore: missing.store,
    })).rejects.toMatchObject({ code: "PREPARED_ARTWORK_MISSING" });
    expect((missingDatabase.client as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();

    const changedDatabase = fakeDatabase();
    const changed = artworkStore();
    changed.store.readPending = vi.fn(async () => Uint8Array.of(8, 8, 8, 8));
    await createImportPreviewJob("session-a", character("Changed artwork"), "artifact-upload", {
      client: changedDatabase.client, now: NOW, artwork: changed.binding,
    });
    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: changedDatabase.client, now: NOW, artworkStore: changed.store,
    })).rejects.toMatchObject({ code: "PREPARED_ARTWORK_INVALID" });
    expect((changedDatabase.client as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("compensates and deletes a newly promoted final object when the database transaction fails", async () => {
    const database = fakeDatabase();
    const artwork = artworkStore();
    await createImportPreviewJob("session-a", character("Failed save"), "artifact-upload", {
      client: database.client, now: NOW, artwork: artwork.binding,
    });
    mocks.persist.mockRejectedValueOnce(new Error("database rollback"));

    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, {
      client: database.client, now: NOW, artworkStore: artwork.store,
    })).rejects.toThrow("database rollback");
    expect(artwork.store.promotePending).toHaveBeenCalledTimes(1);
    expect(artwork.store.deleteFinal).toHaveBeenCalledWith(`artwork/sha256/${artwork.binding.sha256}.png`);
    expect(artwork.store.deletePending).not.toHaveBeenCalled();
  });

  it("loads an exact session-owned Companion review without retrieving upstream", async () => {
    const database = fakeDatabase();
    await createImportPreviewJob("session-a", character("Batch review"), "browser-bridge", { client: database.client, now: NOW });

    await expect(getImportPreviewJob("session-a", JOB_ID, { client: database.client, now: NOW })).resolves.toMatchObject({
      previewJobId: JOB_ID,
      preview: { name: "Batch review", provider: "browser-bridge", duplicateAnalysis: { classification: "NO_MATCH" } },
    });
    await expect(getImportPreviewJob("session-b", JOB_ID, { client: database.client, now: NOW }))
      .rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND" });
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("does not disclose cross-session jobs and rejects expired or unknown versions", async () => {
    const database = fakeDatabase();
    await createImportPreviewJob("session-a", character("Reviewed A"), "manual-json", { client: database.client, now: NOW });

    await expect(saveImportPreviewJob("session-b", PRINCIPAL, JOB_ID, { client: database.client, now: NOW }))
      .rejects.toMatchObject({ code: "PREVIEW_NOT_FOUND" });

    database.row!.expiresAt = new Date(NOW.getTime() - 1);
    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, { client: database.client, now: NOW }))
      .rejects.toMatchObject({ code: "PREVIEW_EXPIRED" });

    database.row!.expiresAt = new Date(NOW.getTime() + 60_000);
    database.row!.snapshotVersion = 99;
    await expect(saveImportPreviewJob("session-a", PRINCIPAL, JOB_ID, { client: database.client, now: NOW }))
      .rejects.toMatchObject({ code: "INVALID_SOURCE_PAYLOAD" });
  });

  it("deletes only preview jobs outside the 24-hour retention window", async () => {
    const database = fakeDatabase();
    database.deleteCount = 2;
    await expect(cleanupImportPreviewJobs(database.client, NOW)).resolves.toBe(2);
    expect(database.lastDeleteWhere).toEqual(expect.objectContaining({ OR: expect.any(Array) }));
  });
});

function character(name: string): NormalizedCharacter {
  return {
    externalId: "d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    platform: "JANITOR_AI",
    sourceUrl: "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7",
    name,
    description: "Description",
    personality: null,
    scenario: null,
    exampleDialogs: null,
    avatarUrl: null,
    creator: { externalId: "creator-1", name: "Creator" },
    greetings: [{ content: "Hello", position: 0 }],
    tags: [{ externalId: "tag-1", name: "#Fantasy", slug: "fantasy" }],
    lorebookReferences: [{ externalId: "lore-1", title: "World" }],
    sourceCreatedAt: null,
    sourceUpdatedAt: null,
    rawData: { upstreamSecretField: "upstream-secret-field" },
  };
}

function fakeDatabase() {
  type Row = {
    id: string; userSessionId: string; snapshotVersion: number; snapshot: unknown;
    expiresAt: Date; consumedAt: Date | null; savedCharacterId: string | null;
  };
  const state: {
    row: Row | null;
    deleteCount: number;
    lastDeleteWhere: unknown;
    artworkUpserts: Array<{ create: Record<string, unknown> }>;
  } = { row: null, deleteCount: 0, lastDeleteWhere: null, artworkUpserts: [] };
  const tx = {
    importPreviewJob: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Omit<Row, "id" | "consumedAt" | "savedCharacterId"> }) => {
        state.row = { id: JOB_ID, ...data, consumedAt: null, savedCharacterId: null };
        return { id: JOB_ID };
      }),
      findFirst: vi.fn(async ({ where }: { where: { id: string; userSessionId: string } }) =>
        state.row?.id === where.id && state.row.userSessionId === where.userSessionId ? { ...state.row } : null),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.row?.id === where.id ? { ...state.row } : null),
      updateMany: vi.fn(async () => {
        if (!state.row || state.row.consumedAt) return { count: 0 };
        state.row.consumedAt = NOW;
        return { count: 1 };
      }),
      update: vi.fn(async ({ data }: { data: { savedCharacterId: string } }) => {
        if (state.row) state.row.savedCharacterId = data.savedCharacterId;
        return state.row;
      }),
      deleteMany: vi.fn(async ({ where }: { where: unknown }) => {
        state.lastDeleteWhere = where;
        return { count: state.deleteCount };
      }),
    },
    artworkAsset: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
      upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => {
        state.artworkUpserts.push({ create });
        return create;
      }),
    },
  };
  const client = {
    ...tx,
    blockRule: { findMany: vi.fn(async () => []) },
    blockedCreator: { findMany: vi.fn(async () => []) },
    characterSource: { findUnique: vi.fn(async () => null) },
    character: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  return Object.assign(state, { client: client as never });
}

function artworkStore(): { binding: PendingArtworkBinding; bytes: Uint8Array; store: ArtworkObjectStore & Record<string, ReturnType<typeof vi.fn>> } {
  const bytes = Uint8Array.of(137, 80, 78, 71);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const binding: PendingArtworkBinding = {
    sha256,
    mediaType: "image/png",
    byteLength: bytes.byteLength,
    width: 1,
    height: 1,
    pendingKey: `pending-artwork/${NOW.getTime() + 60 * 60 * 1_000}/aaaaaaaaaaaaaaaaaaaaaaaa/00000000-0000-4000-8000-000000000000.png`,
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000).toISOString(),
  };
  const store = {
    putPending: vi.fn(),
    readPending: vi.fn(async () => bytes),
    promotePending: vi.fn(async () => ({ ...binding, storageKey: `artwork/sha256/${sha256}.png`, created: true })),
    readFinal: vi.fn(),
    deletePending: vi.fn(async () => undefined),
    deleteFinal: vi.fn(async () => undefined),
    statFinal: vi.fn(),
    cleanupExpiredPending: vi.fn(),
  } as unknown as ArtworkObjectStore & Record<string, ReturnType<typeof vi.fn>>;
  return { binding, bytes, store };
}

void ImportPreviewJobError;
