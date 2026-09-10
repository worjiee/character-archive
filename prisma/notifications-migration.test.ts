import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("./migrations/20260905121500_add_notifications/migration.sql", import.meta.url), "utf8");

describe("first notifications migration", () => {
  it("only adds Notification schema objects and its User foreign key", () => {
    expect(sql).toContain('CREATE TYPE "NotificationCategory"');
    expect(sql).toContain('CREATE TABLE "Notification"');
    expect(sql).toContain('REFERENCES "User"("id") ON DELETE CASCADE');
    expect(sql).not.toMatch(/^\s*(?:DROP\b|DELETE\s+FROM\b|UPDATE\s+|TRUNCATE\b|RENAME\b)/imu);
    const alteredTables = [...sql.matchAll(/ALTER TABLE\s+"([^"]+)"/giu)].map((match) => match[1]);
    expect(alteredTables).toEqual(["Notification"]);
    const createdTables = [...sql.matchAll(/CREATE TABLE\s+"([^"]+)"/giu)].map((match) => match[1]);
    expect(createdTables).toEqual(["Notification"]);
  });
});
