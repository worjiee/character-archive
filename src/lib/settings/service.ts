import type { PrismaClient, ThemePreference } from "../../../generated/prisma/client";

export const REPOSITORY_SETTINGS_ID = "repository";

export interface RepositorySettingsDto {
  id: string;
  siteName: string;
  siteSubtitle: string | null;
  logoUrl: string | null;
  accentColor: string | null;
  defaultTheme: ThemePreference;
}

export class SettingsValidationError extends Error {
  constructor(message: string) { super(message); this.name = "SettingsValidationError"; }
}

export async function getRepositorySettings(client?: PrismaClient): Promise<RepositorySettingsDto> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const settings = await database.repositorySettings.findUnique({
    where: { id: REPOSITORY_SETTINGS_ID },
    select: {
      id: true,
      siteName: true,
      siteSubtitle: true,
      logoUrl: true,
      accentColor: true,
      defaultTheme: true,
    },
  });
  return settings ?? defaultRepositorySettings();
}

export async function updateRepositorySettings(
  input: Record<string, unknown>,
  client?: PrismaClient,
): Promise<RepositorySettingsDto> {
  const database = client ?? (await import("../../../lib/prisma")).prisma;
  const siteName = requiredText(input.siteName, "Website name", 80);
  const siteSubtitle = optionalText(input.siteSubtitle, "Subtitle", 160);
  const logoUrl = optionalUrl(input.logoUrl);
  const accentColor = optionalAccent(input.accentColor);
  const defaultTheme = themePreference(input.defaultTheme);

  return database.repositorySettings.upsert({
    where: { id: REPOSITORY_SETTINGS_ID },
    update: { siteName, siteSubtitle, logoUrl, accentColor, defaultTheme },
    create: {
      id: REPOSITORY_SETTINGS_ID,
      siteName,
      siteSubtitle,
      logoUrl,
      accentColor,
      defaultTheme,
    },
    select: {
      id: true,
      siteName: true,
      siteSubtitle: true,
      logoUrl: true,
      accentColor: true,
      defaultTheme: true,
    },
  });
}

export function defaultRepositorySettings(): RepositorySettingsDto {
  return {
    id: REPOSITORY_SETTINGS_ID,
    siteName: "Chikpeas",
    siteSubtitle: "Character repository",
    logoUrl: null,
    accentColor: "#8b5cf6",
    defaultTheme: "DARK",
  };
}

function requiredText(value: unknown, label: string, maximum: number): string {
  const text = optionalText(value, label, maximum);
  if (!text) throw new SettingsValidationError(`${label} is required.`);
  return text;
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new SettingsValidationError(`${label} must be text.`);
  const text = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (!text) return null;
  if (text.length > maximum) throw new SettingsValidationError(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

function optionalUrl(value: unknown): string | null {
  const text = optionalText(value, "Logo URL", 2048);
  if (!text) return null;
  if (text.startsWith("/") && !text.startsWith("//")) return text;
  try {
    const url = new URL(text);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch { /* handled below */ }
  throw new SettingsValidationError("Logo URL must be an HTTP(S) URL or a local path beginning with /.");
}

function optionalAccent(value: unknown): string | null {
  const text = optionalText(value, "Accent color", 7);
  if (!text) return null;
  if (!/^#[0-9a-f]{6}$/iu.test(text)) {
    throw new SettingsValidationError("Accent color must be a six-digit hexadecimal color.");
  }
  return text.toLowerCase();
}

function themePreference(value: unknown): ThemePreference {
  if (value === "DARK" || value === "LIGHT" || value === "SYSTEM") return value;
  throw new SettingsValidationError("Theme preference must be DARK, LIGHT, or SYSTEM.");
}
