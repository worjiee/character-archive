import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ requireUserApiSession: vi.fn(), getAuthenticatedUserApiSession: vi.fn() }));
const previewJobs = vi.hoisted(() => ({ saveImportPreviewJob: vi.fn() }));
vi.mock("@/src/lib/auth", () => auth);
vi.mock("../../../../src/lib/importers/preview-jobs", () => previewJobs);

import { POST } from "./route";

describe("browser bridge immutable preview save route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "user-session-1",
      principal: { userId: "initial-admin", username: "admin", displayName: "Admin", role: "ADMIN" },
    });
    previewJobs.saveImportPreviewJob.mockResolvedValue({ characterId: "character-1" });
  });

  it("does not allow a bridge preview to bypass Archive authentication", async () => {
    auth.requireUserApiSession.mockResolvedValue(Response.json({ error: "Authentication required." }, { status: 401 }));
    const response = await POST(request({ method: "browser-bridge", previewJobId: "preview-job-123456" }));
    expect(response.status).toBe(401);
    expect(previewJobs.saveImportPreviewJob).not.toHaveBeenCalled();
  });

  it("saves the exact reviewed ImportPreviewJob snapshot, not BridgeJob payload", async () => {
    const response = await POST(request({
      method: "browser-bridge",
      previewJobId: "preview-job-123456",
      linkMode: "ATTACH_TO_EXISTING",
      targetCharacterId: "character-existing",
    }));
    expect(response.status).toBe(200);
    expect(previewJobs.saveImportPreviewJob).toHaveBeenCalledWith(
      "user-session-1",
      expect.objectContaining({ userId: "initial-admin" }),
      "preview-job-123456",
      { targetCharacterId: "character-existing" },
    );
  });
});

function request(body: unknown): Request {
  return new Request("http://localhost:3000/api/import/save", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
