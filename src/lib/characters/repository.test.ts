import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getCharacterById } from "./repository";

describe("character repository", () => {
  it("resolves local display overrides for a focused detail record", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "character-1",
      name: "Imported name",
      nameOverride: "Owner name",
      avatarUrl: "/source.svg",
      avatarUrlOverride: "/owner.svg",
      description: "Imported description",
      descriptionOverride: "Owner description",
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
      status: "ACTIVE",
      personality: null,
      personalityOverride: null,
      scenario: null,
      scenarioOverride: null,
      exampleDialogs: null,
      blockedReason: null,
      greetings: [],
      sources: [],
      tags: [],
      lorebooks: [],
    });
    const result = await getCharacterById("character-1", { character: { findUnique } } as unknown as PrismaClient);
    expect(result).toMatchObject({
      name: "Owner name",
      avatarUrl: "/owner.svg",
      description: "Owner description",
    });
  });
});
