import { describe, expect, it } from "vitest";
import {
  getSourceIdentity,
  SOURCE_IDENTITIES,
  SOURCE_NAVIGATION_PLATFORM_KEYS,
} from "./presentation";

describe("source presentation catalog", () => {
  it.each([
    ["JANITOR_AI", "Janitor AI", "J.AI", "J.AI"],
    ["SAUCEPAN", "Saucepan", "S", "S"],
    ["DATACAT", "Datacat", "D", "D"],
    ["OTHER", "Other", "?", "?"],
  ] as const)("defines the %s identity", (platform, label, shortLabel, mark) => {
    expect(getSourceIdentity(platform)).toMatchObject({
      key: platform,
      label,
      shortLabel,
      mark,
    });
  });

  it("reserves Janny without treating Other as Janny", () => {
    expect(SOURCE_NAVIGATION_PLATFORM_KEYS).toContain("JANNY");
    expect(SOURCE_IDENTITIES.JANNY).toMatchObject({
      label: "Janny",
      shortLabel: "Janny",
      mark: "J",
    });
    expect(getSourceIdentity("OTHER").key).toBe("OTHER");
    expect(getSourceIdentity("OTHER").label).not.toBe("Janny");
  });

  it("falls back safely for missing and unknown platforms", () => {
    expect(getSourceIdentity("UNKNOWN_PLATFORM")).toBe(SOURCE_IDENTITIES.OTHER);
    expect(getSourceIdentity(null)).toBe(SOURCE_IDENTITIES.OTHER);
  });

  it("uses the current Datacat product name", () => {
    expect(getSourceIdentity("DATACAT").label).toBe("Datacat");
    expect(getSourceIdentity("DATACAT").label).not.toBe("Legacy source");
  });
});
