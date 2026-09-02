import { DKU_LOCATIONS_LOREBOOK_ID } from "./dku-locations-lorebook-fixture";

export interface DevelopmentFixtureIdentity {
  platform: "JANITOR_AI";
  externalId: string;
}

export const DEVELOPMENT_FIXTURE_LOREBOOK_IDENTITIES = [
  {
    platform: "JANITOR_AI",
    externalId: DKU_LOCATIONS_LOREBOOK_ID,
  },
] as const satisfies readonly DevelopmentFixtureIdentity[];

export const PROTECTED_REAL_LOREBOOK_EXTERNAL_IDS = [
  "adb43eef-53a0-4e26-a0fd-8d20a8544fbc",
  "49cf7265-362e-43e1-b993-5ac95780be00",
  "ee83a581-ab42-4598-aae1-c7a0ed5a3521",
] as const;

export function isDevelopmentFixtureLorebookIdentity(
  identity: DevelopmentFixtureIdentity,
): boolean {
  return DEVELOPMENT_FIXTURE_LOREBOOK_IDENTITIES.some(
    (fixture) =>
      fixture.platform === identity.platform &&
      fixture.externalId === identity.externalId,
  );
}
