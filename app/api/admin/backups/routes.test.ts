import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireAdminApiSession: vi.fn() }));
const backupService = vi.hoisted(() => ({
  getArchiveHealth: vi.fn(),
  validateBackupManifest: vi.fn(),
}));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/backup/service", () => backupService);

import { GET as getHealth } from "./health/route";
import { POST as postValidate } from "./validate/route";

const MOCK_HEALTH = {
  database: {
    status: "healthy" as const,
    totalCharacters: 355,
    totalSources: 355,
    totalVersions: 355,
    totalGreetings: 990,
    totalTags: 50,
    totalLorebooks: 67,
  },
  artwork: {
    totalAssets: 350,
    totalBytes: 371700000,
    storageObjects: 350,
    missingCurrentArtwork: [],
    brokenHistoricalArtwork: [],
    orphanArtwork: [],
    storageMismatch: [],
  },
  migrations: {
    isUpToDate: true,
    appliedCount: 15,
    latestMigration: "20260914_baseline",
  },
  operational: {
    sessionCount: 1,
    notificationCount: 0,
  },
};

describe("Admin Backup API Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireAdminApiSession.mockResolvedValue(null);
    backupService.getArchiveHealth.mockResolvedValue(MOCK_HEALTH);
    backupService.validateBackupManifest.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      summary: { formatVersion: 1 },
    });
  });

  describe("GET /api/admin/backups/health", () => {
    it("returns 403 Forbidden for MEMBER users", async () => {
      auth.requireAdminApiSession.mockResolvedValue(
        Response.json({ error: "Administrator access required." }, { status: 403 }),
      );

      const req = new Request("http://localhost/api/admin/backups/health");
      const res = await getHealth(req);
      expect(res.status).toBe(403);
      expect(backupService.getArchiveHealth).not.toHaveBeenCalled();
    });

    it("returns 401 Unauthorized for unauthenticated requests", async () => {
      auth.requireAdminApiSession.mockResolvedValue(
        Response.json({ error: "Authentication required." }, { status: 401 }),
      );

      const req = new Request("http://localhost/api/admin/backups/health");
      const res = await getHealth(req);
      expect(res.status).toBe(401);
      expect(backupService.getArchiveHealth).not.toHaveBeenCalled();
    });

    it("returns 200 with archive health for ADMIN users", async () => {
      const req = new Request("http://localhost/api/admin/backups/health");
      const res = await getHealth(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const data = await res.json();
      expect(data.health.database.totalCharacters).toBe(355);
      expect(data.health.artwork.totalAssets).toBe(350);
      expect(backupService.getArchiveHealth).toHaveBeenCalledWith({ spotCheckStorage: false });
    });

    it("passes spotCheckStorage: true if query param is set", async () => {
      const req = new Request("http://localhost/api/admin/backups/health?spotCheck=true");
      const res = await getHealth(req);
      expect(res.status).toBe(200);
      expect(backupService.getArchiveHealth).toHaveBeenCalledWith({ spotCheckStorage: true });
    });
  });

  describe("POST /api/admin/backups/validate", () => {
    it("returns 403 Forbidden for MEMBER users", async () => {
      auth.requireAdminApiSession.mockResolvedValue(
        Response.json({ error: "Administrator access required." }, { status: 403 }),
      );

      const req = new Request("http://localhost/api/admin/backups/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "test" }),
      });
      const res = await postValidate(req);
      expect(res.status).toBe(403);
      expect(backupService.validateBackupManifest).not.toHaveBeenCalled();
    });

    it("returns 200 with validation result for ADMIN users", async () => {
      const payload = { format: "character-archive-backup", formatVersion: 1 };
      const req = new Request("http://localhost/api/admin/backups/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await postValidate(req);
      expect(res.status).toBe(200);
      expect(backupService.validateBackupManifest).toHaveBeenCalledWith(payload);
      const data = await res.json();
      expect(data.result.valid).toBe(true);
    });

    it("returns 400 Bad Request for malformed JSON", async () => {
      const req = new Request("http://localhost/api/admin/backups/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "NOT_VALID_JSON{",
      });

      const res = await postValidate(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("INVALID_JSON");
    });
  });
});
