import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  getAuthenticatedUserApiSession: vi.fn(),
  requireUserApiSession: vi.fn(),
}));
const previewJobs = vi.hoisted(() => ({
  createImportPreviewJob: vi.fn(),
  saveImportPreviewJob: vi.fn(),
}));
const retrieval = vi.hoisted(() => ({
  defaultSourceOrchestrator: { retrieveSingleCharacter: vi.fn(), retrieveSingleCandidate: vi.fn(), supportState: vi.fn() },
}));
const janitor = vi.hoisted(() => ({ normalizeManualJanitorCharacter: vi.fn() }));

vi.mock("@/src/lib/auth", () => auth);
vi.mock("../../../src/lib/importers/preview-jobs", () => previewJobs);
vi.mock("../../../src/lib/importers/retrieval", () => retrieval);
vi.mock("../../../src/lib/importers/janitor", () => janitor);

import { POST as preview } from "./preview/route";
import { POST as save } from "./save/route";

describe("PUBLIC_ONLY import authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireUserApiSession.mockResolvedValue(null);
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "member-session",
      principal: { userId: "member-1", role: "MEMBER" },
    });
    retrieval.defaultSourceOrchestrator.supportState.mockReturnValue({ state: "AVAILABLE", detectedProvider: "JANITOR_AI", resolution: { success: true, target: {} } });
    retrieval.defaultSourceOrchestrator.retrieveSingleCandidate.mockResolvedValue({ name: "Preview" });
    janitor.normalizeManualJanitorCharacter.mockReturnValue({ name: "Manual preview" });
    previewJobs.createImportPreviewJob.mockResolvedValue({ previewJobId: PREVIEW_JOB_ID, preview: { name: "Preview" } });
    previewJobs.saveImportPreviewJob.mockResolvedValue({ characterId: "character-1" });
  });

  it("uses PUBLIC_ONLY for both MEMBER preview and job-based save", async () => {
    expect((await preview(request("preview", { method: "automatic-url", url: SOURCE_URL }))).status).toBe(200);
    expect(retrieval.defaultSourceOrchestrator.retrieveSingleCandidate).toHaveBeenCalledWith(SOURCE_URL, { mode: "PUBLIC_ONLY" });
    expect(previewJobs.createImportPreviewJob).toHaveBeenCalledWith("member-session", { name: "Preview" }, "automatic-url");

    expect((await save(request("save", { method: "automatic-url", previewJobId: PREVIEW_JOB_ID }))).status).toBe(200);
    expect(previewJobs.saveImportPreviewJob).toHaveBeenCalledWith(
      "member-session",
      { userId: "member-1", role: "MEMBER" },
      PREVIEW_JOB_ID,
      { targetCharacterId: undefined },
    );
    expect(retrieval.defaultSourceOrchestrator.retrieveSingleCandidate).toHaveBeenCalledTimes(1);
  });

  it("uses the same immutable preview boundary for manual JSON", async () => {
    const body = { method: "manual-json", url: SOURCE_URL, sourceJson: "{}" };
    expect((await preview(request("preview", body))).status).toBe(200);
    expect(janitor.normalizeManualJanitorCharacter).toHaveBeenCalledWith(SOURCE_URL, "{}");
    expect(previewJobs.createImportPreviewJob).toHaveBeenCalledWith("member-session", { name: "Manual preview" }, "manual-json");
  });

  it("rejects MEMBER force-linking before preview consumption", async () => {
    const response = await save(request("save", {
      method: "automatic-url",
      previewJobId: PREVIEW_JOB_ID,
      linkMode: "ATTACH_TO_EXISTING",
      targetCharacterId: "character-existing",
    }));
    expect(response.status).toBe(403);
    expect(previewJobs.saveImportPreviewJob).not.toHaveBeenCalled();
  });

  it("uses PUBLIC_ONLY for ordinary ADMIN preview too", async () => {
    auth.getAuthenticatedUserApiSession.mockResolvedValue({
      sessionId: "admin-session",
      principal: { userId: "initial-admin", role: "ADMIN" },
    });
    expect((await preview(request("preview", { method: "automatic-url", url: SOURCE_URL }))).status).toBe(200);
    expect(retrieval.defaultSourceOrchestrator.retrieveSingleCandidate).toHaveBeenCalledWith(SOURCE_URL, { mode: "PUBLIC_ONLY" });
  });
});

const SOURCE_URL = "https://janitorai.com/characters/d7745ac8-8b75-48ec-aaf9-5699ad547cd7";
const PREVIEW_JOB_ID = "cm1234567890abcdef123456";

function request(action: "preview" | "save", body: unknown): Request {
  return new Request(`http://localhost:3000/api/import/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
