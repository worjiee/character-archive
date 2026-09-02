import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const transferScript = readFileSync(
  new URL("./copy-client-preview-dataset.ts", import.meta.url),
  "utf8",
);

describe("client preview dataset transfer guard", () => {
  it("reads the physical User.accessStatus column as status", () => {
    expect(transferScript).toContain(
      'SELECT id, role::text, "accessStatus"::text AS status FROM "User" ORDER BY id',
    );
    expect(transferScript).not.toContain(
      'SELECT id, role::text, status::text FROM "User"',
    );
  });
});
