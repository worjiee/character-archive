import { describe, expect, it } from "vitest";
import { authorIdentityForSource, normalizeCreatorName } from "./identity";

describe("author identity", () => {
  it("prefers an exact source external creator ID", () => {
    expect(authorIdentityForSource({ platform: "JANITOR_AI", externalCreatorId: " creator-1 ", creatorName: "Creator" })).toEqual({ platform: "JANITOR_AI", kind: "EXTERNAL_ID", value: "creator-1" });
  });

  it("falls back to a Unicode and whitespace normalized source-scoped name", () => {
    expect(normalizeCreatorName("  Ｃreator\t Name ")).toBe("creator name");
    expect(authorIdentityForSource({ platform: "DATACAT", externalCreatorId: null, creatorName: "  Creator   Name " })).toEqual({ platform: "DATACAT", kind: "CREATOR_NAME", value: "creator name" });
  });

  it("does not fabricate an identity for unusable source data", () => {
    expect(authorIdentityForSource({ platform: "SAUCEPAN", externalCreatorId: " ", creatorName: null })).toBeNull();
  });

  it("keeps identical normalized names on different platforms separate", () => {
    const janitor = authorIdentityForSource({ platform: "JANITOR_AI", externalCreatorId: null, creatorName: "DarkMountain" });
    const saucepan = authorIdentityForSource({ platform: "SAUCEPAN", externalCreatorId: null, creatorName: "darkmountain" });
    expect(janitor).toEqual({ platform: "JANITOR_AI", kind: "CREATOR_NAME", value: "darkmountain" });
    expect(saucepan).toEqual({ platform: "SAUCEPAN", kind: "CREATOR_NAME", value: "darkmountain" });
    expect(janitor?.platform).not.toBe(saucepan?.platform);
  });
});
