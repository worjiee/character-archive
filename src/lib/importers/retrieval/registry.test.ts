import { describe, expect, it, vi } from "vitest";
import { SourceAdapterRegistry } from "./registry";

describe("universal source resolver registry", () => {
  it.each([
    ["https://datacat.run/characters/janitor/d7745ac8-8b75-48ec-aaf9-5699ad547cd7", "DATACAT", "RECOGNIZED_PENDING_CAPABILITY"],
    ["https://saucepan.ai/companion/d7745ac8-8b75-48ec-aaf9-5699ad547cd7", "SAUCEPAN", "RECOGNIZED_UNAVAILABLE"],
  ])("recognizes %s without enabling retrieval", (url, provider, state) => {
    const registry = new SourceAdapterRegistry();
    const resolved = registry.resolveTarget(url);
    expect(resolved.success).toBe(true);
    expect(registry.supportState(resolved)).toBe(state);
    if (resolved.success) expect(resolved.target.importProvider).toBe(provider);
  });

  it("does not call any fetch implementation for recognized unavailable sources", async () => {
    const registry = new SourceAdapterRegistry();
    const resolved = registry.resolveTarget("https://datacat.run/characters/janitor/d7745ac8-8b75-48ec-aaf9-5699ad547cd7");
    expect(resolved.success).toBe(true);
    if (!resolved.success) return;
    const fetchMock = vi.fn();
    const result = await registry.getAdapter("DATACAT")!.retrieveCharacter(resolved.target, { fetch: fetchMock });
    expect(result.status).toBe("UNSUPPORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("classifies unknown hosts as unsupported", () => {
    const registry = new SourceAdapterRegistry();
    const resolved = registry.resolveTarget("https://unknown.example/characters/1");
    expect(registry.supportState(resolved)).toBe("UNSUPPORTED");
    expect(resolved).toMatchObject({ success: false, code: "UNSUPPORTED_HOST" });
  });
});
