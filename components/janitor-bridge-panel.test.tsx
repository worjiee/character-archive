import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "components/janitor-bridge-panel.tsx"), "utf8");

describe("Janitor profile batch review", () => {
  it("creates an explicit target-kind request and presents truthful pairing controls", () => {
    expect(source).toContain("bridgePairingRequestForUrl");
    expect(source).toContain("JSON.stringify(pairingRequest)");
    expect(source).not.toContain("JSON.stringify({ sourceUrl:");
    expect(source).toContain('"Pair Profile"');
    expect(source).toContain('"Pair Character"');
    expect(source).toContain("Profile pairing target");
    expect(source).toContain("Character pairing target");
  });

  it("keeps discovery selection and save selection explicit", () => {
    expect(source).toContain("Select all discovered");
    expect(source).toContain("Deselect all");
    expect(source).toContain("selected of");
    expect(source).toContain("Send selection to companion");
    expect(source).toContain("Select all ready");
    expect(source).toContain("Save selected");
  });

  it("uses per-character preview jobs and isolated saves without a second Janitor fetch", () => {
    expect(source).toContain("/api/import/previews/");
    expect(source).toContain('fetch("/api/import/save"');
    expect(source).toContain('method: "browser-bridge"');
    expect(source).not.toContain("hampter/characters");
  });

  it("bounds long review lists and reports truthful truncation/progress", () => {
    expect(source).toContain("max-h-[28rem]");
    expect(source).toContain("overflow-x-hidden");
    expect(source).toContain("Showing the first 100 discovered characters.");
    expect(source).toContain("failed ·");
    expect(source).toContain("queued");
  });
});
