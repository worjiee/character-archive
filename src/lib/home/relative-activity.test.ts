import { describe, expect, it } from "vitest";
import { relativeActivityLabel } from "./relative-activity";

const NOW = "2026-08-25T12:00:00.000Z";

describe("relativeActivityLabel", () => {
  it("preserves the existing deterministic labels", () => {
    expect(relativeActivityLabel(NOW, NOW)).toBe("Just now");
    expect(relativeActivityLabel("2026-08-25T11:48:00.000Z", NOW)).toBe("12m ago");
    expect(relativeActivityLabel("2026-08-25T10:00:00.000Z", NOW)).toBe("2h ago");
    expect(relativeActivityLabel("2026-08-24T10:00:00.000Z", NOW)).toBe("1d ago");
  });

  it("clamps future activity to Just now using only supplied values", () => {
    expect(relativeActivityLabel("2026-08-25T12:01:00.000Z", NOW)).toBe("Just now");
  });
});
