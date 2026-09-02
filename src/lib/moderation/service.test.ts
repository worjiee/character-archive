import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "../../../generated/prisma/client";
import type { ModerationCharacterRecord, ModerationCriteria } from "./service";
import { moderateQuarantinedCharacter, recheckCharacterRecords } from "./service";

function record(status: ModerationCharacterRecord["status"], overrides: Partial<ModerationCharacterRecord> = {}): ModerationCharacterRecord {
  return {
    id: `character-${status}`,
    status,
    name: "Force Ghost",
    description: "Anakin Skywalker appears",
    personality: null,
    scenario: null,
    exampleDialogs: null,
    greetings: [],
    tags: [],
    sources: [],
    ...overrides,
  };
}

const criteria: ModerationCriteria = {
  rules: [{ id: "keyword", type: "KEYWORD", value: "Anakin Skywalker", enabled: true }],
  blockedCreators: [],
};

describe("recheckCharacterRecords", () => {
  it("quarantines matching ACTIVE characters and reports the affected count", async () => {
    const quarantine = vi.fn().mockResolvedValue(undefined);
    const count = await recheckCharacterRecords(
      [record("ACTIVE"), record("ACTIVE", { id: "safe", description: "A safe description" })],
      criteria,
      quarantine,
    );
    expect(count).toBe(1);
    expect(quarantine).toHaveBeenCalledWith("character-ACTIVE", [expect.objectContaining({ ruleId: "keyword" })]);
  });

  it("preserves existing BLOCKED status during rechecks", async () => {
    const quarantine = vi.fn().mockResolvedValue(undefined);
    const count = await recheckCharacterRecords([record("BLOCKED")], criteria, quarantine);
    expect(count).toBe(0);
    expect(quarantine).not.toHaveBeenCalled();
  });

  it("does not re-quarantine existing QUARANTINED or DELETED characters", async () => {
    const quarantine = vi.fn().mockResolvedValue(undefined);
    const count = await recheckCharacterRecords([record("QUARANTINED"), record("DELETED")], criteria, quarantine);
    expect(count).toBe(0);
    expect(quarantine).not.toHaveBeenCalled();
  });
});

describe("moderateQuarantinedCharacter publication", () => {
  it("sets first publication when approving a never-published quarantine", async () => {
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: {
        findUnique: vi.fn().mockResolvedValue({ status: "QUARANTINED", publishedAt: null }),
        update,
      },
    });

    await moderateQuarantinedCharacter("character-1", "restore", client);

    expect(update).toHaveBeenCalledWith({
      where: { id: "character-1" },
      data: {
        status: "ACTIVE",
        blockedReason: null,
        lastCheckedAt: expect.any(Date),
        publishedAt: expect.any(Date),
      },
    });
  });

  it("keeps an old publication timestamp when restoring a published quarantine", async () => {
    const publishedAt = new Date("2026-08-20T09:00:00.000Z");
    const update = vi.fn().mockResolvedValue({});
    const client = transactionClient({
      character: {
        findUnique: vi.fn().mockResolvedValue({ status: "QUARANTINED", publishedAt }),
        update,
      },
    });

    await moderateQuarantinedCharacter("character-1", "restore", client);

    expect(update.mock.calls[0][0].data.publishedAt).toBe(publishedAt);
  });
});

function transactionClient(tx: object): PrismaClient {
  return {
    $transaction: vi.fn(async (
      callback: (client: Prisma.TransactionClient) => Promise<unknown>,
      options?: { isolationLevel?: string },
    ) => {
      void options;
      return callback(tx as Prisma.TransactionClient);
    }),
  } as unknown as PrismaClient;
}
