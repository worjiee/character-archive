import { describe, expect, it, vi } from "vitest";
import type { ModerationCharacterRecord, ModerationCriteria } from "./service";
import { recheckCharacterRecords } from "./service";

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
