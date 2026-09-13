import { describe, expect, it, vi } from "vitest";
import {
  COLLECTION_NAME_MAX_LENGTH,
  COLLECTION_DESCRIPTION_MAX_LENGTH,
  MAX_COLLECTIONS_PER_USER,
  CustomCollectionConflictError,
  CustomCollectionLimitError,
  CustomCollectionNotFoundError,
  CustomCollectionValidationError,
  createUserCollection,
  deleteUserCollection,
  getCharacterCollectionMemberships,
  getUserCollection,
  validateCollectionDescription,
  validateCollectionName,
} from "./custom-collections";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedPrincipal } from "../auth/session";

const principalA: AuthenticatedPrincipal = {
  userId: "user-a",
  username: "alice",
  displayName: "Alice",
  role: "MEMBER",
};

const principalB: AuthenticatedPrincipal = {
  userId: "user-b",
  username: "bob",
  displayName: "Bob",
  role: "MEMBER",
};

describe("Custom Collections Domain & Validation", () => {
  describe("validateCollectionName", () => {
    it("accepts valid names and normalizes whitespace", () => {
      const result = validateCollectionName("  My   Favorite Bots  ");
      expect(result.name).toBe("My Favorite Bots");
      expect(result.normalizedName).toBe("my favorite bots");
    });

    it("rejects non-strings and empty strings", () => {
      expect(() => validateCollectionName(null)).toThrow(CustomCollectionValidationError);
      expect(() => validateCollectionName("")).toThrow(CustomCollectionValidationError);
      expect(() => validateCollectionName("   ")).toThrow(CustomCollectionValidationError);
    });

    it("rejects names longer than max length", () => {
      const longName = "a".repeat(COLLECTION_NAME_MAX_LENGTH + 1);
      expect(() => validateCollectionName(longName)).toThrow(CustomCollectionValidationError);
    });

    it("rejects reserved collection names", () => {
      expect(() => validateCollectionName("Favorites")).toThrow(CustomCollectionValidationError);
      expect(() => validateCollectionName("cart")).toThrow(CustomCollectionValidationError);
      expect(() => validateCollectionName("ALL")).toThrow(CustomCollectionValidationError);
      expect(() => validateCollectionName("Characters")).toThrow(CustomCollectionValidationError);
    });
  });

  describe("validateCollectionDescription", () => {
    it("returns null for empty, undefined, or whitespace-only", () => {
      expect(validateCollectionDescription(undefined)).toBeNull();
      expect(validateCollectionDescription(null)).toBeNull();
      expect(validateCollectionDescription("")).toBeNull();
      expect(validateCollectionDescription("   ")).toBeNull();
    });

    it("trims and returns valid description", () => {
      expect(validateCollectionDescription("  A cool list  ")).toBe("A cool list");
    });

    it("rejects descriptions exceeding max length", () => {
      const longDesc = "x".repeat(COLLECTION_DESCRIPTION_MAX_LENGTH + 1);
      expect(() => validateCollectionDescription(longDesc)).toThrow(CustomCollectionValidationError);
    });
  });

  describe("createUserCollection", () => {
    it("enforces maximum 50 collections limit", async () => {
      const mockClient = {
        characterCollection: {
          count: vi.fn().mockResolvedValue(MAX_COLLECTIONS_PER_USER),
        },
      } as unknown as PrismaClient;

      await expect(
        createUserCollection(principalA, { name: "Another List" }, mockClient)
      ).rejects.toThrow(CustomCollectionLimitError);
    });

    it("rejects duplicate normalized names for the same user", async () => {
      const mockClient = {
        characterCollection: {
          count: vi.fn().mockResolvedValue(5),
          findUnique: vi.fn().mockResolvedValue({ id: "col-1", name: "Horror" }),
        },
      } as unknown as PrismaClient;

      await expect(
        createUserCollection(principalA, { name: "horror" }, mockClient)
      ).rejects.toThrow(CustomCollectionConflictError);
    });

    it("successfully creates a collection", async () => {
      const mockClient = {
        characterCollection: {
          count: vi.fn().mockResolvedValue(2),
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: "col-123",
            name: "Sci-Fi",
            normalizedName: "sci-fi",
            description: "Space bots",
            createdAt: new Date("2026-01-01T00:00:00Z"),
            updatedAt: new Date("2026-01-01T00:00:00Z"),
          }),
        },
      } as unknown as PrismaClient;

      const result = await createUserCollection(
        principalA,
        { name: "Sci-Fi", description: "Space bots" },
        mockClient
      );
      expect(result.id).toBe("col-123");
      expect(result.name).toBe("Sci-Fi");
      expect(result.characterCount).toBe(0);
    });
  });

  describe("getUserCollection", () => {
    it("throws 404 if collection not found or owned by another user", async () => {
      const mockClient = {
        characterCollection: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      await expect(getUserCollection(principalA, "col-999", mockClient)).rejects.toThrow(
        CustomCollectionNotFoundError
      );
    });
  });

  describe("deleteUserCollection", () => {
    it("throws 404 if trying to delete another user's collection", async () => {
      const mockClient = {
        characterCollection: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      await expect(deleteUserCollection(principalB, "col-owned-by-a", mockClient)).rejects.toThrow(
        CustomCollectionNotFoundError
      );
    });

    it("successfully deletes when owned by user", async () => {
      const mockClient = {
        characterCollection: {
          findFirst: vi.fn().mockResolvedValue({ id: "col-1", ownerUserId: "user-a" }),
          delete: vi.fn().mockResolvedValue({ id: "col-1" }),
        },
      } as unknown as PrismaClient;

      const res = await deleteUserCollection(principalA, "col-1", mockClient);
      expect(res.success).toBe(true);
      expect(mockClient.characterCollection.delete).toHaveBeenCalledWith({ where: { id: "col-1" } });
    });
  });

  describe("getCharacterCollectionMemberships", () => {
    it("returns all user collections with accurate isMember status", async () => {
      const mockClient = {
        characterCollection: {
          findMany: vi.fn().mockResolvedValue([
            { id: "col-1", name: "Comfort" },
            { id: "col-2", name: "Horror" },
            { id: "col-3", name: "RP" },
          ]),
        },
        characterCollectionItem: {
          findMany: vi.fn().mockResolvedValue([
            { collectionId: "col-1" },
            { collectionId: "col-3" },
          ]),
        },
      } as unknown as PrismaClient;

      const memberships = await getCharacterCollectionMemberships(principalA, "char-123", mockClient);
      expect(memberships).toEqual([
        { collectionId: "col-1", collectionName: "Comfort", isMember: true },
        { collectionId: "col-2", collectionName: "Horror", isMember: false },
        { collectionId: "col-3", collectionName: "RP", isMember: true },
      ]);
    });
  });
});
