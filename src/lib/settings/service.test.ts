import type { PrismaClient } from "../../../generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  defaultRepositorySettings,
  getRepositorySettings,
  SettingsValidationError,
  updateRepositorySettings,
} from "./service";

describe("repository settings", () => {
  it("returns stable defaults when the singleton has not been created", async () => {
    const client = { repositorySettings: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient;
    await expect(getRepositorySettings(client)).resolves.toEqual({
      ...defaultRepositorySettings(),
      siteName: "Character Archive",
      accentColor: "#d6a84b",
    });
  });

  it("persists updates through the singleton upsert", async () => {
    const upsert = vi.fn(async (args) => ({ ...args.create }));
    const client = { repositorySettings: { upsert } } as unknown as PrismaClient;
    const settings = await updateRepositorySettings({
      siteName: " My Library ",
      siteSubtitle: "Private characters",
      logoUrl: "/logo.svg",
      accentColor: "#10B981",
      defaultTheme: "SYSTEM",
    }, client);
    expect(settings).toMatchObject({
      id: "repository",
      siteName: "My Library",
      accentColor: "#10b981",
      defaultTheme: "SYSTEM",
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "repository" },
      update: expect.objectContaining({ siteName: "My Library", defaultTheme: "SYSTEM" }),
    }));
  });

  it("rejects unsafe settings values", async () => {
    const client = { repositorySettings: { upsert: vi.fn() } } as unknown as PrismaClient;
    await expect(updateRepositorySettings({
      siteName: "Test",
      logoUrl: "javascript:alert(1)",
      accentColor: "red",
      defaultTheme: "DARK",
    }, client)).rejects.toBeInstanceOf(SettingsValidationError);
  });
});
