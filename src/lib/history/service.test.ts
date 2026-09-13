import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedPrincipal } from "../auth/session";
import {
  clearCharacterHistory,
  getPaginatedHistory,
  getRecentViews,
  recordCharacterView,
  removeCharacterView,
} from "./service";
import { resetClientTracker, shouldRecordView } from "./client-tracker";

const memberPrincipal: AuthenticatedPrincipal = {
  userId: "member-user-1",
  username: "alice",
  displayName: "Alice",
  role: "MEMBER",
};

const adminPrincipal: AuthenticatedPrincipal = {
  userId: "admin-user-1",
  username: "bob",
  displayName: "Bob",
  role: "ADMIN",
};

describe("Recently Viewed / History Service & Client Tracker", () => {
  beforeEach(() => {
    resetClientTracker();
  });

  describe("client-tracker", () => {
    it("allows recording on initial view and debounces subsequent views within 60s", () => {
      const charId = "char-123";
      const t0 = 100000;
      expect(shouldRecordView(charId, t0)).toBe(true);
      expect(shouldRecordView(charId, t0 + 30000)).toBe(false);
      expect(shouldRecordView(charId, t0 + 59999)).toBe(false);
      expect(shouldRecordView(charId, t0 + 60000)).toBe(true);
    });

    it("tracks different characters independently", () => {
      const t0 = 100000;
      expect(shouldRecordView("char-1", t0)).toBe(true);
      expect(shouldRecordView("char-2", t0)).toBe(true);
      expect(shouldRecordView("char-1", t0 + 1000)).toBe(false);
      expect(shouldRecordView("char-2", t0 + 1000)).toBe(false);
    });

    it("resets cache when resetClientTracker is called", () => {
      const t0 = 100000;
      expect(shouldRecordView("char-1", t0)).toBe(true);
      expect(shouldRecordView("char-1", t0 + 5000)).toBe(false);
      resetClientTracker();
      expect(shouldRecordView("char-1", t0 + 5000)).toBe(true);
    });
  });

  describe("recordCharacterView", () => {
    it("returns recorded: false when character is not found or not visible", async () => {
      const mockClient = {
        character: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      const result = await recordCharacterView(memberPrincipal, "non-existent", { client: mockClient });
      expect(result.recorded).toBe(false);
      expect(mockClient.character.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: "non-existent",
          status: "ACTIVE", // MEMBER only sees ACTIVE
        }),
        select: { id: true },
      });
    });

    it("allows ADMIN to see QUARANTINED and BLOCKED characters", async () => {
      const mockClient = {
        character: {
          findFirst: vi.fn().mockResolvedValue({ id: "quarantined-1" }),
        },
        characterView: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({ lastViewedAt: new Date() }),
        },
      } as unknown as PrismaClient;

      await recordCharacterView(adminPrincipal, "quarantined-1", { client: mockClient });
      expect(mockClient.character.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          id: "quarantined-1",
          status: { not: "DELETED" }, // ADMIN sees ACTIVE, QUARANTINED, BLOCKED
        }),
        select: { id: true },
      });
    });

    it("coalesces views within 60s when existing view is recent", async () => {
      const now = new Date("2026-09-14T10:00:30Z");
      const pastView = new Date("2026-09-14T10:00:00Z"); // 30s ago

      const mockClient = {
        character: {
          findFirst: vi.fn().mockResolvedValue({ id: "char-1" }),
        },
        characterView: {
          findUnique: vi.fn().mockResolvedValue({ lastViewedAt: pastView }),
          upsert: vi.fn(),
        },
      } as unknown as PrismaClient;

      const result = await recordCharacterView(memberPrincipal, "char-1", {
        client: mockClient,
        now,
      });

      expect(result.recorded).toBe(false);
      expect(result.coalesced).toBe(true);
      expect(result.lastViewedAt).toBe(pastView.toISOString());
      expect(mockClient.characterView.upsert).not.toHaveBeenCalled();
    });

    it("upserts view when existing view is older than 60s", async () => {
      const now = new Date("2026-09-14T10:02:00Z");
      const pastView = new Date("2026-09-14T10:00:00Z"); // 120s ago

      const mockClient = {
        character: {
          findFirst: vi.fn().mockResolvedValue({ id: "char-1" }),
        },
        characterView: {
          findUnique: vi.fn().mockResolvedValue({ lastViewedAt: pastView }),
          upsert: vi.fn().mockResolvedValue({ lastViewedAt: now }),
        },
      } as unknown as PrismaClient;

      const result = await recordCharacterView(memberPrincipal, "char-1", {
        client: mockClient,
        now,
      });

      expect(result.recorded).toBe(true);
      expect(result.lastViewedAt).toBe(now.toISOString());
      expect(mockClient.characterView.upsert).toHaveBeenCalledWith({
        where: {
          userId_characterId: {
            userId: memberPrincipal.userId,
            characterId: "char-1",
          },
        },
        create: {
          userId: memberPrincipal.userId,
          characterId: "char-1",
          firstViewedAt: now,
          lastViewedAt: now,
        },
        update: {
          lastViewedAt: now,
        },
        select: {
          lastViewedAt: true,
        },
      });
    });
  });

  describe("getRecentViews", () => {
    it("returns up to limit views mapped to CharacterCardItem", async () => {
      const mockViews = [
        {
          lastViewedAt: new Date("2026-09-14T10:00:00Z"),
          character: {
            id: "c1",
            name: "Character 1",
            nameOverride: null,
            avatarUrl: null,
            avatarUrlOverride: null,
            artworkSha256: null,
            status: "ACTIVE",
            tokenCount: 1500,
            permanentTokenCount: 1200,
            sources: [{ platform: "JANITOR_AI", creatorName: "Creator1", externalCreatorId: "cr1" }],
            tags: [{ tag: { name: "Fantasy", slug: "fantasy" } }],
          },
        },
      ];

      const mockClient = {
        characterView: {
          findMany: vi.fn().mockResolvedValue(mockViews),
        },
      } as unknown as PrismaClient;

      const result = await getRecentViews(memberPrincipal, 6, mockClient);
      expect(result).toHaveLength(1);
      expect(result[0].character.id).toBe("c1");
      expect(result[0].character.name).toBe("Character 1");
      expect(result[0].lastViewedAt).toBe("2026-09-14T10:00:00.000Z");
      expect(mockClient.characterView.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: memberPrincipal.userId,
          }),
          take: 6,
          orderBy: { lastViewedAt: "desc" },
        }),
      );
    });
  });

  describe("getPaginatedHistory", () => {
    it("returns paginated results with page and totalPages calculation", async () => {
      const mockViews = [
        {
          firstViewedAt: new Date("2026-09-13T10:00:00Z"),
          lastViewedAt: new Date("2026-09-14T10:00:00Z"),
          character: {
            id: "c1",
            name: "Character 1",
            nameOverride: null,
            avatarUrl: null,
            avatarUrlOverride: null,
            artworkSha256: null,
            status: "ACTIVE",
            tokenCount: 1500,
            permanentTokenCount: 1200,
            sources: [],
            tags: [],
          },
        },
      ];

      const mockClient = {
        characterView: {
          findMany: vi.fn().mockResolvedValue(mockViews),
          count: vi.fn().mockResolvedValue(49),
        },
      } as unknown as PrismaClient;

      const result = await getPaginatedHistory(memberPrincipal, 2, 24, mockClient);
      expect(result.items).toHaveLength(1);
      expect(result.totalCount).toBe(49);
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3); // Math.ceil(49 / 24) = 3
      expect(mockClient.characterView.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 24,
          take: 24,
        }),
      );
    });
  });

  describe("removeCharacterView and clearCharacterHistory", () => {
    it("deletes single character view for principal", async () => {
      const mockClient = {
        characterView: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as PrismaClient;

      const result = await removeCharacterView(memberPrincipal, "c1", mockClient);
      expect(result).toBe(true);
      expect(mockClient.characterView.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: memberPrincipal.userId,
          characterId: "c1",
        },
      });
    });

    it("clears all views for principal", async () => {
      const mockClient = {
        characterView: {
          deleteMany: vi.fn().mockResolvedValue({ count: 15 }),
        },
      } as unknown as PrismaClient;

      const result = await clearCharacterHistory(memberPrincipal, mockClient);
      expect(result.count).toBe(15);
      expect(mockClient.characterView.deleteMany).toHaveBeenCalledWith({
        where: {
          userId: memberPrincipal.userId,
        },
      });
    });
  });
});