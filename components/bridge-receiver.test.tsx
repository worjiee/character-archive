import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENT_SOURCE = readFileSync(
  resolve(process.cwd(), "components/bridge-receiver.tsx"),
  "utf8",
);

describe("BridgeReceiver", () => {
  it("renders a visible receiver shell before client initialization", () => {
    expect(COMPONENT_SOURCE).toContain("Character Archive");
    expect(COMPONENT_SOURCE).toContain("Waiting for Janitor");
    expect(COMPONENT_SOURCE).toContain("One-time pairing code");
  });

  it("does not consume the channel fragment during Strict Mode effect replay", () => {
    expect(COMPONENT_SOURCE).not.toContain("history.replaceState");
  });

  it("contains no automatic close path; close is an explicit error-state action", () => {
    expect(COMPONENT_SOURCE.match(/window\.close\(\)/gu)).toHaveLength(1);
    expect(COMPONENT_SOURCE).toContain("onClick={() => window.close()}");
  });
});
