import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { listCharacters } from "./repository";

describe("character repository", () => {
  it("excludes deleted characters and resolves local display overrides", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "character-1",
      name: "Imported name",
      nameOverride: "Owner name",
      avatarUrl: "/source.svg",
      avatarUrlOverride: "/owner.svg",
      status: "ACTIVE",
      sources: [],
      tags: [],
    }]);
    const result = await listCharacters({ character: { findMany } } as unknown as PrismaClient);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { not: "DELETED" } },
    }));
    expect(result[0]).toMatchObject({ name: "Owner name", avatarUrl: "/owner.svg" });
  });
});
