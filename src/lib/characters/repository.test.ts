import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { TEST_ADMIN_PRINCIPAL, TEST_MEMBER_PRINCIPAL } from "../auth/test-principals";
import { getCharacterById } from "./repository";

describe("character repository", () => {
  it("resolves local display overrides for a focused detail record", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "character-1",
      name: "Imported name",
      nameOverride: "Owner name",
      avatarUrl: "/source.svg",
      avatarUrlOverride: "/owner.svg",
      description: "Imported description",
      descriptionOverride: '<p>Owner &amp; description</p><img src="x" onerror="bad()">',
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-18T00:00:00.000Z"),
      publishedAt: new Date("2026-08-01T00:00:00.000Z"),
      firstAddedBy: { displayName: "Archive Admin", username: "admin" },
      status: "ACTIVE",
      personality: "<strong>Imported personality</strong>",
      personalityOverride: null,
      scenario: null,
      scenarioOverride: null,
      exampleDialogs: "Example<br>dialog",
      blockedReason: null,
      greetings: [],
      sources: [],
      tags: [],
      lorebooks: [],
    });
    const result = await getCharacterById("character-1", TEST_ADMIN_PRINCIPAL, { character: { findFirst } } as unknown as PrismaClient);
    expect(result).toMatchObject({
      name: "Owner name",
      avatarUrl: "/owner.svg",
      description: "Owner & description",
      personality: "Imported personality",
      exampleDialogs: "Example\ndialog",
    });
  });

  it("limits MEMBER details and greetings to ACTIVE visible content", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await getCharacterById("character-1", TEST_MEMBER_PRINCIPAL, { character: { findFirst } } as unknown as PrismaClient);
    const query = findFirst.mock.calls[0]?.[0];
    expect(query.where.AND).toContainEqual({
      status: "ACTIVE",
      publishedAt: { not: null },
    });
    expect(query.select.greetings.where).toEqual({ hidden: false });
  });
});
