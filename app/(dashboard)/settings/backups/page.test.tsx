import { describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireAdminPageSession: vi.fn() }));
const backupService = vi.hoisted(() => ({ getArchiveHealth: vi.fn() }));
const nextServer = vi.hoisted(() => ({ connection: vi.fn() }));

vi.mock("next/server", () => nextServer);
vi.mock("@/src/lib/auth", () => auth);
vi.mock("@/src/lib/backup/service", () => backupService);
vi.mock("@/components/backup-recovery-dashboard", () => ({
  BackupRecoveryDashboard: ({ initialHealth }: { initialHealth: { database: { status: string } } }) => (
    <div data-testid="backup-dashboard">{initialHealth.database.status}</div>
  ),
}));

import BackupsPage from "./page";

describe("BackupsPage Server Component", () => {
  it("enforces requireAdminPageSession and provides initial archive health", async () => {
    auth.requireAdminPageSession.mockResolvedValue({ role: "ADMIN" });
    backupService.getArchiveHealth.mockResolvedValue({
      database: { status: "healthy" },
    });

    const pageElement = await BackupsPage();
    expect(nextServer.connection).toHaveBeenCalled();
    expect(auth.requireAdminPageSession).toHaveBeenCalled();
    expect(backupService.getArchiveHealth).toHaveBeenCalled();
    expect(pageElement).toBeDefined();
  });
});
