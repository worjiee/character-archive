import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const extensionFile = (path: string) => readFileSync(resolve(process.cwd(), "browser-extension", path), "utf8");

describe("companion transport source boundaries", () => {
  it("gives the isolated content boundary no network or storage capability", () => {
    const source = extensionFile("content-script.js");
    expect(source).not.toMatch(/\bfetch\b|XMLHttpRequest|localStorage|sessionStorage|indexedDB|chrome\.storage/iu);
    expect(source).not.toMatch(/Authorization|document\.cookie|\.headers/iu);
  });

  it("keeps Archive destination selection and capability access in the background worker", () => {
    const config = extensionFile("config.js");
    const controller = extensionFile("lib/background-controller.js");
    const popup = extensionFile("popup.js");
    expect(config).toContain('archiveOrigin: "http://localhost:3000"');
    expect(controller).toContain("`${config.archiveOrigin}/api/bridge/extension/import`");
    expect(controller).not.toMatch(/Authorization|document\.cookie|localStorage|sessionStorage|indexedDB|owner_session/iu);
    expect(controller).not.toMatch(/https:\/\/(?:www\.)?janitorai\.com\/hampter/iu);
    expect(popup).not.toMatch(/bridgeToken|X-Archive-Bridge-Token|chrome\.storage/iu);
  });

  it("does not contain a privileged or arbitrary Janitor networking fallback", () => {
    const allRuntime = [
      "page-observer.js",
      "content-script.js",
      "background.js",
      "lib/background-controller.js",
    ].map(extensionFile).join("\n");
    expect(allRuntime).not.toContain("GM_xmlhttpRequest");
    expect(allRuntime).not.toContain("webRequest");
    expect(allRuntime).not.toContain("debugger");
    expect(allRuntime).not.toMatch(/fetch\(["'`]https:\/\/(?:www\.)?janitorai\.com/iu);
  });
});
